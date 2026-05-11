import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../db/index.js'
import { notificationDeliveries, notifications } from '../db/schema.js'
import { enqueueOutboxEvent } from './outbox.js'
import { redisPublisher } from './redis.js'

type DbExecutor = Pick<typeof db, 'insert'>

export function notificationFields() {
  return {
    id: notifications.id,
    recipientUserId: notifications.recipientUserId,
    actorUserId: notifications.actorUserId,
    workspaceId: notifications.workspaceId,
    type: notifications.type,
    entityType: notifications.entityType,
    entityId: notifications.entityId,
    title: notifications.title,
    body: notifications.body,
    metadata: notifications.metadata,
    readAt: notifications.readAt,
    createdAt: notifications.createdAt,
  }
}

export type NotificationRow = typeof notifications.$inferSelect

export type CreateNotificationInput = {
  recipientUserId: string
  actorUserId: string
  workspaceId?: string | null
  type: typeof notifications.$inferInsert.type
  entityType: string
  entityId: string
  title: string
  body: string
  metadata?: unknown
  dedupeKey: string
}

export async function getUnreadNotificationCount(userId: string) {
  const rows = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(and(eq(notifications.recipientUserId, userId), isNull(notifications.readAt)))

  return rows.length
}

export async function publishNotification(notification: NotificationRow) {
  const unreadCount = await getUnreadNotificationCount(notification.recipientUserId)

  await redisPublisher.publish(
    `user:${notification.recipientUserId}:notifications`,
    JSON.stringify({
      type: 'notification.created',
      notification,
      unreadCount,
    }),
  )
}

export async function createNotification(executor: DbExecutor, input: CreateNotificationInput) {
  const [notification] = await executor
    .insert(notifications)
    .values({
      recipientUserId: input.recipientUserId,
      actorUserId: input.actorUserId,
      workspaceId: input.workspaceId ?? null,
      type: input.type,
      entityType: input.entityType,
      entityId: input.entityId,
      title: input.title,
      body: input.body,
      metadata: JSON.stringify(input.metadata ?? {}),
      dedupeKey: input.dedupeKey,
    })
    .onConflictDoNothing()
    .returning()

  if (!notification) {
    return null
  }

  await executor
    .insert(notificationDeliveries)
    .values({
      notificationId: notification.id,
      channel: 'realtime',
      status: 'pending',
    })
    .onConflictDoNothing()

  await enqueueOutboxEvent(executor, {
    eventType: 'notification.created',
    aggregateType: 'notification',
    aggregateId: notification.id,
    workspaceId: notification.workspaceId,
    actorUserId: notification.actorUserId,
    payload: { notificationId: notification.id, channel: 'realtime' },
    idempotencyKey: `notification:${notification.id}:realtime`,
    jobType: 'notification.deliver.realtime',
  })

  return notification
}
