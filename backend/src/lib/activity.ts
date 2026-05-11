import type { db } from '../db/index.js'
import { activityEvents } from '../db/schema.js'
import { enqueueOutboxEvent } from './outbox.js'

type DbExecutor = Pick<typeof db, 'insert'>

export type ActivityInput = {
  workspaceId: string
  actorUserId: string
  eventType: string
  entityType: string
  entityId: string
  summary: string
  metadata?: unknown
}

export async function appendActivity(executor: DbExecutor, input: ActivityInput) {
  const [activity] = await executor
    .insert(activityEvents)
    .values({
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      eventType: input.eventType,
      entityType: input.entityType,
      entityId: input.entityId,
      summary: input.summary,
      metadata: JSON.stringify(input.metadata ?? {}),
    })
    .returning()

  await enqueueOutboxEvent(executor, {
    eventType: 'activity.created',
    aggregateType: 'activity',
    aggregateId: activity.id,
    workspaceId: input.workspaceId,
    actorUserId: input.actorUserId,
    payload: activity,
    idempotencyKey: `activity:${activity.id}`,
  })

  return activity
}
