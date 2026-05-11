import { Router } from 'express'
import { and, desc, eq, lt } from 'drizzle-orm'
import { db } from '../db/index.js'
import { activityEvents, users } from '../db/schema.js'
import { requireWorkspaceRole } from '../lib/workspace-access.js'
import { requireAuth } from '../middleware/auth.js'

export const activityRouter = Router()

activityRouter.use(requireAuth)

function normalizeLimit(value: unknown) {
  const limit = Number(value)
  return Number.isInteger(limit) && limit > 0 ? Math.min(limit, 100) : 50
}

activityRouter.get('/workspaces/:workspaceId/activity', async (req, res) => {
  const userId = req.auth!.user.id
  const { workspaceId } = req.params
  const limit = normalizeLimit(req.query.limit)
  const cursor = typeof req.query.cursor === 'string' && req.query.cursor ? new Date(req.query.cursor) : null
  const access = await requireWorkspaceRole(userId, workspaceId)

  if (!access.ok) {
    res.status(access.status).json({ error: access.error })
    return
  }

  const rows = await db
    .select({
      id: activityEvents.id,
      workspaceId: activityEvents.workspaceId,
      actorUserId: activityEvents.actorUserId,
      actorName: users.name,
      actorEmail: users.email,
      eventType: activityEvents.eventType,
      entityType: activityEvents.entityType,
      entityId: activityEvents.entityId,
      summary: activityEvents.summary,
      metadata: activityEvents.metadata,
      createdAt: activityEvents.createdAt,
    })
    .from(activityEvents)
    .leftJoin(users, eq(activityEvents.actorUserId, users.id))
    .where(cursor ? and(eq(activityEvents.workspaceId, workspaceId), lt(activityEvents.createdAt, cursor)) : eq(activityEvents.workspaceId, workspaceId))
    .orderBy(desc(activityEvents.createdAt), desc(activityEvents.id))
    .limit(limit + 1)

  const hasMore = rows.length > limit
  const page = hasMore ? rows.slice(0, limit) : rows

  res.json({
    activity: page,
    nextCursor: hasMore ? page[page.length - 1]?.createdAt.toISOString() ?? null : null,
  })
})
