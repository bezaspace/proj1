import { Router } from 'express'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { db } from '../db/index.js'
import { auditEvents, chatChannels } from '../db/schema.js'
import {
  chatChannelFields,
  ensureGeneralChannel,
  getVisibleChannel,
  listChannelMessages,
  normalizeChannelName,
} from '../lib/chat.js'
import { rateLimit } from '../lib/rate-limit.js'
import { requireWorkspaceRole } from '../lib/workspace-access.js'
import { requireAuth } from '../middleware/auth.js'
import { appendActivity } from '../lib/activity.js'

export const chatRouter = Router()

chatRouter.use(requireAuth)

function normalizeLimit(value: unknown) {
  const limit = Number(value)
  return Number.isInteger(limit) && limit > 0 ? Math.min(limit, 100) : 50
}

function normalizeBeforeSequence(value: unknown) {
  const sequence = Number(value)
  return Number.isInteger(sequence) && sequence > 0 ? sequence : null
}

chatRouter.get('/workspaces/:workspaceId/channels', async (req, res) => {
  const userId = req.auth!.user.id
  const { workspaceId } = req.params
  const access = await requireWorkspaceRole(userId, workspaceId)

  if (!access.ok) {
    res.status(access.status).json({ error: access.error })
    return
  }

  await ensureGeneralChannel(workspaceId, userId)

  const channels = await db
    .select(chatChannelFields())
    .from(chatChannels)
    .where(and(eq(chatChannels.workspaceId, workspaceId), isNull(chatChannels.archivedAt)))
    .orderBy(desc(chatChannels.updatedAt))

  res.json({ channels })
})

chatRouter.post(
  '/workspaces/:workspaceId/channels',
  rateLimit({ keyPrefix: 'chat_channel_create', limit: 20, windowSeconds: 60 }),
  async (req, res) => {
    const userId = req.auth!.user.id
    const { workspaceId } = req.params
    const name = normalizeChannelName(req.body?.name)
    const access = await requireWorkspaceRole(userId, workspaceId, 'member')

    if (!access.ok) {
      res.status(access.status).json({ error: access.error })
      return
    }

    if (name.length < 2 || name.length > 60) {
      res.status(400).json({ error: 'Channel name must be between 2 and 60 characters.' })
      return
    }

    try {
      const channel = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(chatChannels)
          .values({
            workspaceId,
            name,
            createdByUserId: userId,
          })
          .returning()

        await tx.insert(auditEvents).values({
          actorUserId: userId,
          action: 'chat.channel_created',
          workspaceId,
          metadata: JSON.stringify({ channelId: created.id, name }),
        })

        await appendActivity(tx, {
          workspaceId,
          actorUserId: userId,
          eventType: 'chat.channel_created',
          entityType: 'chat_channel',
          entityId: created.id,
          summary: `Channel #${created.name} was created`,
          metadata: { name: created.name },
        })

        return created
      })

      res.status(201).json({ channel })
    } catch (error) {
      if (typeof error === 'object' && error && 'code' in error && error.code === '23505') {
        res.status(409).json({ error: 'A channel with that name already exists.' })
        return
      }

      throw error
    }
  },
)

chatRouter.get('/workspaces/:workspaceId/channels/:channelId/messages', async (req, res) => {
  const userId = req.auth!.user.id
  const { workspaceId, channelId } = req.params
  const access = await requireWorkspaceRole(userId, workspaceId)

  if (!access.ok) {
    res.status(access.status).json({ error: access.error })
    return
  }

  const channel = await getVisibleChannel(workspaceId, channelId)

  if (!channel) {
    res.status(404).json({ error: 'Channel not found' })
    return
  }

  const payload = await listChannelMessages(channelId, normalizeBeforeSequence(req.query.beforeSequence), normalizeLimit(req.query.limit))
  res.json(payload)
})
