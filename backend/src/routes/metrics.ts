import { Router } from 'express'
import { eq, sql } from 'drizzle-orm'
import { db } from '../db/index.js'
import { backgroundJobs, jobAttempts, uploadSessions } from '../db/schema.js'
import { renderMetrics } from '../lib/metrics.js'
import { requireAuth } from '../middleware/auth.js'

export const metricsRouter = Router()

metricsRouter.get('/metrics', async (_req, res) => {
  const jobsByStatus = await db
    .select({ status: backgroundJobs.status, count: sql<number>`count(*)::int` })
    .from(backgroundJobs)
    .groupBy(backgroundJobs.status)

  const queueDepth = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(backgroundJobs)
    .where(eq(backgroundJobs.status, 'queued'))

  const jobLines = jobsByStatus.map((row) => `background_jobs_total{status="${row.status}"} ${row.count}`)
  jobLines.push(`background_jobs_queue_depth ${queueDepth[0]?.count ?? 0}`)

  res.type('text/plain').send(`${renderMetrics()}${jobLines.join('\n')}\n`)
})

metricsRouter.get('/api/system/queues', requireAuth, async (_req, res) => {
  const [jobsByStatus, recentFailures, uploadSessionsByStatus] = await Promise.all([
    db
      .select({ status: backgroundJobs.status, count: sql<number>`count(*)::int` })
      .from(backgroundJobs)
      .groupBy(backgroundJobs.status),
    db
      .select({
        jobId: jobAttempts.jobId,
        attemptNumber: jobAttempts.attemptNumber,
        status: jobAttempts.status,
        error: jobAttempts.error,
        finishedAt: jobAttempts.finishedAt,
      })
      .from(jobAttempts)
      .where(eq(jobAttempts.status, 'failed'))
      .orderBy(sql`${jobAttempts.finishedAt} desc nulls last`)
      .limit(20),
    db
      .select({ status: uploadSessions.status, count: sql<number>`count(*)::int` })
      .from(uploadSessions)
      .groupBy(uploadSessions.status),
  ])

  res.json({
    jobsByStatus,
    recentFailures,
    uploadSessionsByStatus,
  })
})
