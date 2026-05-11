import { and, asc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { db } from '../db/index.js'
import {
  backgroundJobs,
  fileVersions,
  files,
  jobAttempts,
  notificationDeliveries,
  notificationPreferences,
  notifications,
  outboxEvents,
  uploadSessionBlocks,
  uploadSessions,
} from '../db/schema.js'
import { invalidateCachePatterns } from './cache.js'
import { incrementMetric } from './metrics.js'
import { removeStoredObject } from './object-storage.js'
import { publishNotification } from './notifications.js'

const workerId = `worker-${process.pid}-${randomUUID()}`

function parsePayload(value: string) {
  try {
    return JSON.parse(value) as Record<string, unknown>
  } catch {
    return {}
  }
}

function backoffSeconds(attempts: number) {
  return Math.min(60, 2 ** Math.max(0, attempts))
}

async function deliverRealtimeNotification(payload: Record<string, unknown>) {
  const notificationId = typeof payload.notificationId === 'string' ? payload.notificationId : ''

  const [notification] = await db
    .select()
    .from(notifications)
    .where(eq(notifications.id, notificationId))
    .limit(1)

  if (!notification) {
    return
  }

  const [preference] = await db
    .select({
      realtimeEnabled: notificationPreferences.realtimeEnabled,
      inAppEnabled: notificationPreferences.inAppEnabled,
    })
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, notification.recipientUserId))
    .limit(1)

  if (preference && (!preference.realtimeEnabled || !preference.inAppEnabled)) {
    await db
      .update(notificationDeliveries)
      .set({ status: 'skipped', updatedAt: new Date() })
      .where(and(eq(notificationDeliveries.notificationId, notification.id), eq(notificationDeliveries.channel, 'realtime')))
    return
  }

  await publishNotification(notification)

  await db
    .update(notificationDeliveries)
    .set({
      status: 'delivered',
      attempts: sql`${notificationDeliveries.attempts} + 1`,
      deliveredAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(notificationDeliveries.notificationId, notification.id), eq(notificationDeliveries.channel, 'realtime')))
}

async function expireUploadSessions() {
  const expiredSessions = await db
    .select()
    .from(uploadSessions)
    .where(and(eq(uploadSessions.status, 'pending'), lte(uploadSessions.expiresAt, new Date())))
    .limit(20)

  for (const session of expiredSessions) {
    const blocks = await db
      .select({ objectKey: uploadSessionBlocks.objectKey, uploadedAt: uploadSessionBlocks.uploadedAt })
      .from(uploadSessionBlocks)
      .where(eq(uploadSessionBlocks.sessionId, session.id))

    await db.transaction(async (tx) => {
      await tx
        .update(uploadSessions)
        .set({ status: 'expired', lastError: 'Upload session expired', updatedAt: new Date() })
        .where(and(eq(uploadSessions.id, session.id), eq(uploadSessions.status, 'pending')))

      await tx
        .update(fileVersions)
        .set({ uploadStatus: 'failed' })
        .where(and(eq(fileVersions.id, session.versionId), eq(fileVersions.uploadStatus, 'pending')))

      await tx
        .update(files)
        .set({ uploadStatus: 'failed', updatedAt: new Date() })
        .where(and(eq(files.id, session.fileId), eq(files.uploadStatus, 'pending')))
    })

    for (const block of blocks) {
      if (!block.uploadedAt) {
        await removeStoredObject(block.objectKey).catch(() => undefined)
      }
    }

    incrementMetric('upload_sessions_expired_total')
  }
}

async function runJob(job: typeof backgroundJobs.$inferSelect) {
  const attemptNumber = job.attempts + 1
  const [attempt] = await db
    .insert(jobAttempts)
    .values({
      jobId: job.id,
      attemptNumber,
      status: 'running',
    })
    .returning()

  try {
    const payload = parsePayload(job.payload)

    if (job.jobType === 'notification.deliver.realtime') {
      await deliverRealtimeNotification(payload)
    }

    if (job.jobType === 'cache.invalidate') {
      const patterns = Array.isArray(payload.patterns) ? payload.patterns.filter((item): item is string => typeof item === 'string') : []
      await invalidateCachePatterns(patterns)
    }

    if (job.jobType === 'upload_sessions.expire') {
      await expireUploadSessions()
    }

    await db.transaction(async (tx) => {
      await tx
        .update(backgroundJobs)
        .set({
          status: 'succeeded',
          attempts: attemptNumber,
          lockedAt: null,
          lockedBy: null,
          lastError: null,
          updatedAt: new Date(),
        })
        .where(eq(backgroundJobs.id, job.id))

      if (job.outboxEventId) {
        await tx
          .update(outboxEvents)
          .set({ status: 'processed', processedAt: new Date() })
          .where(eq(outboxEvents.id, job.outboxEventId))
      }

      await tx
        .update(jobAttempts)
        .set({ status: 'succeeded', finishedAt: new Date() })
        .where(eq(jobAttempts.id, attempt.id))
    })

    incrementMetric('background_jobs_succeeded_total', { job_type: job.jobType })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown job failure'
    const terminal = attemptNumber >= job.maxAttempts

    await db.transaction(async (tx) => {
      await tx
        .update(backgroundJobs)
        .set({
          status: terminal ? 'dead' : 'failed',
          attempts: attemptNumber,
          runAfter: new Date(Date.now() + backoffSeconds(attemptNumber) * 1000),
          lockedAt: null,
          lockedBy: null,
          lastError: message,
          updatedAt: new Date(),
        })
        .where(eq(backgroundJobs.id, job.id))

      await tx
        .update(jobAttempts)
        .set({ status: terminal ? 'dead' : 'failed', error: message, finishedAt: new Date() })
        .where(eq(jobAttempts.id, attempt.id))
    })

    incrementMetric('background_jobs_failed_total', { job_type: job.jobType, terminal: String(terminal) })
  }
}

export async function processDueJobs(limit = 10) {
  await expireUploadSessions()

  const now = new Date()
  const jobs = await db
    .select()
    .from(backgroundJobs)
    .where(
      and(
        inArray(backgroundJobs.status, ['queued', 'failed']),
        lte(backgroundJobs.runAfter, now),
        or(isNull(backgroundJobs.lockedBy), lte(backgroundJobs.lockedAt, new Date(Date.now() - 60_000))),
      ),
    )
    .orderBy(asc(backgroundJobs.runAfter), asc(backgroundJobs.createdAt))
    .limit(limit)

  for (const job of jobs) {
    const [lockedJob] = await db
      .update(backgroundJobs)
      .set({ status: 'running', lockedAt: new Date(), lockedBy: workerId, updatedAt: new Date() })
      .where(and(eq(backgroundJobs.id, job.id), inArray(backgroundJobs.status, ['queued', 'failed'])))
      .returning()

    if (lockedJob) {
      await runJob(lockedJob)
    }
  }

  return jobs.length
}

export function startWorkerLoop(intervalMs = 1500) {
  const timer = setInterval(() => {
    void processDueJobs().catch((error) => {
      console.error('Background worker failed', error)
      incrementMetric('background_worker_errors_total')
    })
  }, intervalMs)

  timer.unref()
  return timer
}
