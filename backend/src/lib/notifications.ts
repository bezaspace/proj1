import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../db/index.js'
import { notifications } from '../db/schema.js'
import { redisPublisher } from './redis.js'

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

