import { Router } from 'express'
import { and, desc, eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { auditEvents, workspaceMembers, workspaces } from '../db/schema.js'
import { requireAuth } from '../middleware/auth.js'

export const workspacesRouter = Router()

workspacesRouter.use(requireAuth)

workspacesRouter.get('/workspaces', async (req, res) => {
  const userId = req.auth!.user.id

  const rows = await db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      role: workspaceMembers.role,
      createdAt: workspaces.createdAt,
      updatedAt: workspaces.updatedAt,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
    .where(eq(workspaceMembers.userId, userId))
    .orderBy(desc(workspaces.createdAt))

  res.json({ workspaces: rows })
})

workspacesRouter.post('/workspaces', async (req, res) => {
  const userId = req.auth!.user.id
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : ''

  if (name.length < 2 || name.length > 80) {
    res.status(400).json({ error: 'Workspace name must be between 2 and 80 characters.' })
    return
  }

  const [workspace] = await db.transaction(async (tx) => {
    const [createdWorkspace] = await tx
      .insert(workspaces)
      .values({
        name,
        createdByUserId: userId,
      })
      .returning()

    await tx.insert(workspaceMembers).values({
      workspaceId: createdWorkspace.id,
      userId,
      role: 'owner',
    })

    await tx.insert(auditEvents).values({
      actorUserId: userId,
      action: 'workspace.created',
      workspaceId: createdWorkspace.id,
      metadata: JSON.stringify({ name }),
    })

    return [createdWorkspace]
  })

  res.status(201).json({ workspace: { ...workspace, role: 'owner' } })
})

workspacesRouter.get('/workspaces/:workspaceId', async (req, res) => {
  const userId = req.auth!.user.id
  const workspaceId = req.params.workspaceId

  const [row] = await db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      role: workspaceMembers.role,
      createdAt: workspaces.createdAt,
      updatedAt: workspaces.updatedAt,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
    .where(and(eq(workspaceMembers.userId, userId), eq(workspaces.id, workspaceId)))
    .limit(1)

  if (!row) {
    res.status(404).json({ error: 'Workspace not found' })
    return
  }

  res.json({ workspace: row })
})
