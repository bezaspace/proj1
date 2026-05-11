import type { db } from '../db/index.js'
import { backgroundJobs, outboxEvents } from '../db/schema.js'

type DbExecutor = Pick<typeof db, 'insert'>

export type OutboxInput = {
  eventType: string
  aggregateType: string
  aggregateId: string
  workspaceId?: string | null
  actorUserId?: string | null
  payload?: unknown
  idempotencyKey: string
  jobType?: string
  maxAttempts?: number
}

export async function enqueueOutboxEvent(executor: DbExecutor, input: OutboxInput) {
  const [event] = await executor
    .insert(outboxEvents)
    .values({
      eventType: input.eventType,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      workspaceId: input.workspaceId ?? null,
      actorUserId: input.actorUserId ?? null,
      payload: JSON.stringify(input.payload ?? {}),
      idempotencyKey: input.idempotencyKey,
    })
    .onConflictDoNothing()
    .returning()

  if (!event || !input.jobType) {
    return event ?? null
  }

  await executor
    .insert(backgroundJobs)
    .values({
      outboxEventId: event.id,
      jobType: input.jobType,
      payload: event.payload,
      maxAttempts: input.maxAttempts ?? 5,
      idempotencyKey: `${input.jobType}:${input.idempotencyKey}`,
    })
    .onConflictDoNothing()

  return event
}
