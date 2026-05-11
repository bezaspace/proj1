import { Router } from 'express'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { db } from '../db/index.js'
import { notifications } from '../db/schema.js'
import { getUnreadNotificationCount, notificationFields } from '../lib/notifications.js'
import { requireAuth } from '../middleware/auth.js'

export const notificationsRouter = Router()

notificationsRouter.use(requireAuth)

notificationsRouter.get('/notifications', async (req, res) => {
  const userId = req.auth!.user.id
  const unreadOnly = req.query.unreadOnly === 'true'

  const rows = await db
    .select(notificationFields())
    .from(notifications)
    .where(
      unreadOnly
        ? and(eq(notifications.recipientUserId, userId), isNull(notifications.readAt))
        : eq(notifications.recipientUserId, userId),
    )
    .orderBy(desc(notifications.createdAt))
    .limit(50)

  res.json({ notifications: rows })
})

notificationsRouter.get('/notifications/unread-count', async (req, res) => {
  const userId = req.auth!.user.id
  const unreadCount = await getUnreadNotificationCount(userId)

  res.json({ unreadCount })
})

notificationsRouter.patch('/notifications/:notificationId/read', async (req, res) => {
  const userId = req.auth!.user.id
  const { notificationId } = req.params

  const [notification] = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.id, notificationId), eq(notifications.recipientUserId, userId)))
    .returning(notificationFields())

  if (!notification) {
    res.status(404).json({ error: 'Notification not found' })
    return
  }

  res.json({ notification })
})

notificationsRouter.post('/notifications/mark-all-read', async (req, res) => {
  const userId = req.auth!.user.id
  const now = new Date()

  const rows = await db
    .update(notifications)
    .set({ readAt: now })
    .where(and(eq(notifications.recipientUserId, userId), isNull(notifications.readAt)))
    .returning({ id: notifications.id })

  res.json({ updatedCount: rows.length })
})
