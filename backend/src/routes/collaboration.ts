import { Router } from 'express'
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  auditEvents,
  documents,
  files,
  resourcePermissions,
  users,
  workspaceInvites,
  workspaceMembers,
  workspaces,
} from '../db/schema.js'
import {
  requireResourcePermission,
  requireWorkspaceRole,
  type ResourcePermissionLevel,
  type ResourceType,
  type WorkspaceRole,
} from '../lib/workspace-access.js'
import { appendActivity } from '../lib/activity.js'
import { cacheKeys, invalidateCachePatterns } from '../lib/cache.js'
import { createNotification } from '../lib/notifications.js'
import { enqueueOutboxEvent } from '../lib/outbox.js'
import { rateLimit } from '../lib/rate-limit.js'
import { requireAuth } from '../middleware/auth.js'

export const collaborationRouter = Router()

collaborationRouter.use(requireAuth)

const inviteRoles: WorkspaceRole[] = ['admin', 'member', 'viewer']
const permissionLevels: ResourcePermissionLevel[] = ['view', 'edit', 'owner']

function normalizeEmail(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function normalizeRole(value: unknown): WorkspaceRole | null {
  return typeof value === 'string' && inviteRoles.includes(value as WorkspaceRole) ? (value as WorkspaceRole) : null
}

function normalizePermissionLevel(value: unknown): ResourcePermissionLevel | null {
  return typeof value === 'string' && permissionLevels.includes(value as ResourcePermissionLevel)
    ? (value as ResourcePermissionLevel)
    : null
}

function normalizeResourceType(value: string): ResourceType | null {
  if (value === 'documents') {
    return 'document'
  }

  if (value === 'files') {
    return 'file'
  }

  return null
}

function inviteFields() {
  return {
    id: workspaceInvites.id,
    workspaceId: workspaceInvites.workspaceId,
    email: workspaceInvites.email,
    role: workspaceInvites.role,
    status: workspaceInvites.status,
    invitedByUserId: workspaceInvites.invitedByUserId,
    acceptedByUserId: workspaceInvites.acceptedByUserId,
    expiresAt: workspaceInvites.expiresAt,
    acceptedAt: workspaceInvites.acceptedAt,
    revokedAt: workspaceInvites.revokedAt,
    createdAt: workspaceInvites.createdAt,
    updatedAt: workspaceInvites.updatedAt,
  }
}

function grantFields() {
  return {
    id: resourcePermissions.id,
    workspaceId: resourcePermissions.workspaceId,
    resourceType: resourcePermissions.resourceType,
    resourceId: resourcePermissions.resourceId,
    userId: resourcePermissions.userId,
    level: resourcePermissions.level,
    grantedByUserId: resourcePermissions.grantedByUserId,
    createdAt: resourcePermissions.createdAt,
    updatedAt: resourcePermissions.updatedAt,
    userName: users.name,
    userEmail: users.email,
  }
}

async function findUserByEmail(email: string) {
  const [user] = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(sql`lower(${users.email}) = ${email}`)
    .limit(1)

  return user ?? null
}

async function getResource(workspaceId: string, resourceType: ResourceType, resourceId: string) {
  if (resourceType === 'document') {
    const [document] = await db
      .select({
        id: documents.id,
        workspaceId: documents.workspaceId,
        name: documents.title,
        createdByUserId: documents.createdByUserId,
      })
      .from(documents)
      .where(and(eq(documents.workspaceId, workspaceId), eq(documents.id, resourceId), isNull(documents.archivedAt)))
      .limit(1)

    return document ?? null
  }

  const [file] = await db
    .select({
      id: files.id,
      workspaceId: files.workspaceId,
      name: files.name,
      createdByUserId: files.createdByUserId,
    })
    .from(files)
    .where(and(eq(files.workspaceId, workspaceId), eq(files.id, resourceId), isNull(files.archivedAt)))
    .limit(1)

  return file ?? null
}

function notificationCopy(resourceType: ResourceType, resourceName: string) {
  if (resourceType === 'document') {
    return {
      type: 'document_shared' as const,
      title: 'Document shared',
      body: `A document was shared with you: ${resourceName}`,
    }
  }

  return {
    type: 'file_shared' as const,
    title: 'File shared',
    body: `A file was shared with you: ${resourceName}`,
  }
}

collaborationRouter.get('/workspaces/:workspaceId/members', async (req, res) => {
  const userId = req.auth!.user.id
  const { workspaceId } = req.params
  const access = await requireWorkspaceRole(userId, workspaceId)

  if (!access.ok) {
    res.status(access.status).json({ error: access.error })
    return
  }

  const rows = await db
    .select({
      id: workspaceMembers.id,
      workspaceId: workspaceMembers.workspaceId,
      userId: workspaceMembers.userId,
      role: workspaceMembers.role,
      createdAt: workspaceMembers.createdAt,
      updatedAt: workspaceMembers.updatedAt,
      userName: users.name,
      userEmail: users.email,
    })
    .from(workspaceMembers)
    .innerJoin(users, eq(workspaceMembers.userId, users.id))
    .where(eq(workspaceMembers.workspaceId, workspaceId))
    .orderBy(desc(workspaceMembers.createdAt))

  res.json({ members: rows })
})

collaborationRouter.get('/workspaces/:workspaceId/invites', async (req, res) => {
  const userId = req.auth!.user.id
  const { workspaceId } = req.params
  const access = await requireWorkspaceRole(userId, workspaceId, 'admin')

  if (!access.ok) {
    res.status(access.status).json({ error: access.error })
    return
  }

  const rows = await db
    .select(inviteFields())
    .from(workspaceInvites)
    .where(eq(workspaceInvites.workspaceId, workspaceId))
    .orderBy(desc(workspaceInvites.createdAt))

  res.json({ invites: rows })
})

collaborationRouter.post(
  '/workspaces/:workspaceId/invites',
  rateLimit({ keyPrefix: 'workspace_invite_create', limit: 20, windowSeconds: 60 }),
  async (req, res) => {
  const userId = req.auth!.user.id
  const { workspaceId } = req.params
  const email = normalizeEmail(req.body?.email)
  const role = normalizeRole(req.body?.role) ?? 'viewer'
  const access = await requireWorkspaceRole(userId, workspaceId, 'admin')

  if (!access.ok) {
    res.status(access.status).json({ error: access.error })
    return
  }

  if (!email.includes('@') || email.length > 254) {
    res.status(400).json({ error: 'Enter a valid email address.' })
    return
  }

  const invitedUser = await findUserByEmail(email)

  if (invitedUser) {
    const [existingMember] = await db
      .select({ id: workspaceMembers.id })
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, invitedUser.id)))
      .limit(1)

    if (existingMember) {
      res.status(409).json({ error: 'That user is already a workspace member.' })
      return
    }
  }

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

  const payload = await db.transaction(async (tx) => {
    const [existingInvite] = await tx
      .select(inviteFields())
      .from(workspaceInvites)
      .where(
        and(
          eq(workspaceInvites.workspaceId, workspaceId),
          eq(workspaceInvites.email, email),
          eq(workspaceInvites.status, 'pending'),
        ),
      )
      .limit(1)

    const [savedInvite] = existingInvite
      ? await tx
          .update(workspaceInvites)
          .set({ role, expiresAt, updatedAt: new Date() })
          .where(eq(workspaceInvites.id, existingInvite.id))
          .returning()
      : await tx
          .insert(workspaceInvites)
          .values({
            workspaceId,
            email,
            role,
            invitedByUserId: userId,
            expiresAt,
          })
          .returning()

    await tx.insert(auditEvents).values({
      actorUserId: userId,
      action: existingInvite ? 'workspace.invite_refreshed' : 'workspace.invite_created',
      workspaceId,
      metadata: JSON.stringify({ inviteId: savedInvite.id, email, role }),
    })

    if (invitedUser) {
      await createNotification(tx, {
        recipientUserId: invitedUser.id,
        actorUserId: userId,
        workspaceId,
        type: 'workspace_invite',
        entityType: 'workspace_invite',
        entityId: savedInvite.id,
        title: 'Workspace invite',
        body: 'You have been invited to join a workspace.',
        metadata: { workspaceId, inviteId: savedInvite.id, role },
        dedupeKey: `workspace_invite:${savedInvite.id}`,
      })
    }

    await appendActivity(tx, {
      workspaceId,
      actorUserId: userId,
      eventType: existingInvite ? 'workspace.invite_refreshed' : 'workspace.invite_created',
      entityType: 'workspace_invite',
      entityId: savedInvite.id,
      summary: `${email} was invited as ${role}`,
      metadata: { inviteId: savedInvite.id, email, role },
    })

    return { invite: savedInvite }
  })

  res.status(201).json({ invite: payload.invite })
  },
)

collaborationRouter.get('/invites', async (req, res) => {
  const email = normalizeEmail(req.auth!.user.email)

  const rows = await db
    .select({
      ...inviteFields(),
      workspaceName: workspaces.name,
    })
    .from(workspaceInvites)
    .innerJoin(workspaces, eq(workspaceInvites.workspaceId, workspaces.id))
    .where(
      and(
        eq(workspaceInvites.email, email),
        eq(workspaceInvites.status, 'pending'),
        gt(workspaceInvites.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(workspaceInvites.createdAt))

  res.json({ invites: rows })
})

collaborationRouter.post('/invites/:inviteId/accept', async (req, res) => {
  const userId = req.auth!.user.id
  const email = normalizeEmail(req.auth!.user.email)
  const { inviteId } = req.params

  const [invite] = await db
    .select(inviteFields())
    .from(workspaceInvites)
    .where(and(eq(workspaceInvites.id, inviteId), eq(workspaceInvites.email, email), eq(workspaceInvites.status, 'pending')))
    .limit(1)

  if (!invite) {
    res.status(404).json({ error: 'Invite not found' })
    return
  }

  if (invite.expiresAt < new Date()) {
    await db
      .update(workspaceInvites)
      .set({ status: 'expired', updatedAt: new Date() })
      .where(eq(workspaceInvites.id, invite.id))

    res.status(410).json({ error: 'This invite has expired.' })
    return
  }

  const payload = await db.transaction(async (tx) => {
    await tx
      .insert(workspaceMembers)
      .values({
        workspaceId: invite.workspaceId,
        userId,
        role: invite.role,
      })
      .onConflictDoNothing()

    const [acceptedInvite] = await tx
      .update(workspaceInvites)
      .set({
        status: 'accepted',
        acceptedByUserId: userId,
        acceptedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(workspaceInvites.id, invite.id))
      .returning()

    await tx.insert(auditEvents).values({
      actorUserId: userId,
      action: 'workspace.invite_accepted',
      workspaceId: invite.workspaceId,
      metadata: JSON.stringify({ inviteId: invite.id, role: invite.role }),
    })

    await appendActivity(tx, {
      workspaceId: invite.workspaceId,
      actorUserId: userId,
      eventType: 'workspace.invite_accepted',
      entityType: 'workspace_invite',
      entityId: invite.id,
      summary: `Workspace invite was accepted`,
      metadata: { inviteId: invite.id, role: invite.role },
    })

    await enqueueOutboxEvent(tx, {
      eventType: 'cache.invalidate',
      aggregateType: 'workspace',
      aggregateId: invite.workspaceId,
      workspaceId: invite.workspaceId,
      actorUserId: userId,
      payload: { patterns: [cacheKeys.membership(invite.workspaceId, userId)] },
      idempotencyKey: `cache:membership:${invite.workspaceId}:${userId}:${acceptedInvite.id}`,
      jobType: 'cache.invalidate',
      maxAttempts: 3,
    })

    const [workspace] = await tx
      .select({
        id: workspaces.id,
        name: workspaces.name,
        createdAt: workspaces.createdAt,
        updatedAt: workspaces.updatedAt,
      })
      .from(workspaces)
      .where(eq(workspaces.id, invite.workspaceId))
      .limit(1)

    return { invite: acceptedInvite, workspace: { ...workspace, role: invite.role } }
  })

  await invalidateCachePatterns([cacheKeys.membership(invite.workspaceId, userId)])
  res.json(payload)
})

collaborationRouter.delete('/workspaces/:workspaceId/invites/:inviteId', async (req, res) => {
  const userId = req.auth!.user.id
  const { workspaceId, inviteId } = req.params
  const access = await requireWorkspaceRole(userId, workspaceId, 'admin')

  if (!access.ok) {
    res.status(access.status).json({ error: access.error })
    return
  }

  const [invite] = await db
    .update(workspaceInvites)
    .set({ status: 'revoked', revokedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(workspaceInvites.id, inviteId), eq(workspaceInvites.workspaceId, workspaceId), eq(workspaceInvites.status, 'pending')))
    .returning()

  if (!invite) {
    res.status(404).json({ error: 'Pending invite not found' })
    return
  }

  await db.insert(auditEvents).values({
    actorUserId: userId,
    action: 'workspace.invite_revoked',
    workspaceId,
    metadata: JSON.stringify({ inviteId, email: invite.email }),
  })

  await appendActivity(db, {
    workspaceId,
    actorUserId: userId,
    eventType: 'workspace.invite_revoked',
    entityType: 'workspace_invite',
    entityId: inviteId,
    summary: `${invite.email} invite was revoked`,
    metadata: { inviteId, email: invite.email },
  })

  res.json({ invite })
})

collaborationRouter.get('/workspaces/:workspaceId/:resourcePath/:resourceId/permissions', async (req, res) => {
  const userId = req.auth!.user.id
  const { workspaceId, resourcePath, resourceId } = req.params
  const resourceType = normalizeResourceType(resourcePath)

  if (!resourceType) {
    res.status(404).json({ error: 'Resource not found' })
    return
  }

  const resource = await getResource(workspaceId, resourceType, resourceId)

  if (!resource) {
    res.status(404).json({ error: 'Resource not found' })
    return
  }

  const access = await requireResourcePermission(userId, workspaceId, resourceType, resourceId, 'owner')

  if (!access.ok) {
    res.status(access.status).json({ error: access.error })
    return
  }

  const grants = await db
    .select(grantFields())
    .from(resourcePermissions)
    .innerJoin(users, eq(resourcePermissions.userId, users.id))
    .where(
      and(
        eq(resourcePermissions.workspaceId, workspaceId),
        eq(resourcePermissions.resourceType, resourceType),
        eq(resourcePermissions.resourceId, resourceId),
      ),
    )
    .orderBy(desc(resourcePermissions.updatedAt))

  res.json({ grants })
})

collaborationRouter.post('/workspaces/:workspaceId/:resourcePath/:resourceId/permissions', async (req, res) => {
  const actorUserId = req.auth!.user.id
  const { workspaceId, resourcePath, resourceId } = req.params
  const resourceType = normalizeResourceType(resourcePath)
  const email = normalizeEmail(req.body?.email)
  const level = normalizePermissionLevel(req.body?.level) ?? 'view'

  if (!resourceType) {
    res.status(404).json({ error: 'Resource not found' })
    return
  }

  const resource = await getResource(workspaceId, resourceType, resourceId)

  if (!resource) {
    res.status(404).json({ error: 'Resource not found' })
    return
  }

  const access = await requireResourcePermission(actorUserId, workspaceId, resourceType, resourceId, 'owner')

  if (!access.ok) {
    res.status(access.status).json({ error: access.error })
    return
  }

  if (!email.includes('@') || email.length > 254) {
    res.status(400).json({ error: 'Enter a valid email address.' })
    return
  }

  const targetUser = await findUserByEmail(email)

  if (!targetUser) {
    res.status(404).json({ error: 'That user does not have an account yet. Invite them to the workspace first.' })
    return
  }

  const [targetMembership] = await db
    .select({ id: workspaceMembers.id, role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, targetUser.id)))
    .limit(1)

  if (!targetMembership) {
    res.status(400).json({ error: 'Share only with existing workspace members.' })
    return
  }

  const payload = await db.transaction(async (tx) => {
    const [grant] = await tx
      .insert(resourcePermissions)
      .values({
        workspaceId,
        resourceType,
        resourceId,
        userId: targetUser.id,
        level,
        grantedByUserId: actorUserId,
      })
      .onConflictDoUpdate({
        target: [
          resourcePermissions.workspaceId,
          resourcePermissions.resourceType,
          resourcePermissions.resourceId,
          resourcePermissions.userId,
        ],
        set: {
          level,
          grantedByUserId: actorUserId,
          updatedAt: new Date(),
        },
      })
      .returning()

    const copy = notificationCopy(resourceType, resource.name)
    if (targetUser.id !== actorUserId) {
      await createNotification(tx, {
        recipientUserId: targetUser.id,
        actorUserId,
        workspaceId,
        type: copy.type,
        entityType: resourceType,
        entityId: resourceId,
        title: copy.title,
        body: copy.body,
        metadata: { resourceType, resourceId, resourceName: resource.name, level },
        dedupeKey: `${copy.type}:${resourceId}:${targetUser.id}:${level}`,
      })
    }

    await tx.insert(auditEvents).values({
      actorUserId,
      action: `${resourceType}.permission_granted`,
      workspaceId,
      metadata: JSON.stringify({ resourceId, targetUserId: targetUser.id, level }),
    })

    await appendActivity(tx, {
      workspaceId,
      actorUserId,
      eventType: `${resourceType}.permission_granted`,
      entityType: resourceType,
      entityId: resourceId,
      summary: `${resource.name} was shared with ${targetUser.email}`,
      metadata: { resourceType, resourceId, targetUserId: targetUser.id, level },
    })

    await enqueueOutboxEvent(tx, {
      eventType: 'cache.invalidate',
      aggregateType: resourceType,
      aggregateId: resourceId,
      workspaceId,
      actorUserId,
      payload: { patterns: [cacheKeys.resourceGrant(workspaceId, resourceType, resourceId, targetUser.id)] },
      idempotencyKey: `cache:grant:${workspaceId}:${resourceType}:${resourceId}:${targetUser.id}:${grant.updatedAt.getTime()}`,
      jobType: 'cache.invalidate',
      maxAttempts: 3,
    })

    return { grant }
  })

  const [grantWithUser] = await db
    .select(grantFields())
    .from(resourcePermissions)
    .innerJoin(users, eq(resourcePermissions.userId, users.id))
    .where(eq(resourcePermissions.id, payload.grant.id))
    .limit(1)

  await invalidateCachePatterns([cacheKeys.resourceGrant(workspaceId, resourceType, resourceId, targetUser.id)])
  res.status(201).json({ grant: grantWithUser })
})

collaborationRouter.delete('/workspaces/:workspaceId/:resourcePath/:resourceId/permissions/:permissionId', async (req, res) => {
  const actorUserId = req.auth!.user.id
  const { workspaceId, resourcePath, resourceId, permissionId } = req.params
  const resourceType = normalizeResourceType(resourcePath)

  if (!resourceType) {
    res.status(404).json({ error: 'Resource not found' })
    return
  }

  const resource = await getResource(workspaceId, resourceType, resourceId)

  if (!resource) {
    res.status(404).json({ error: 'Resource not found' })
    return
  }

  const access = await requireResourcePermission(actorUserId, workspaceId, resourceType, resourceId, 'owner')

  if (!access.ok) {
    res.status(access.status).json({ error: access.error })
    return
  }

  const [grant] = await db
    .delete(resourcePermissions)
    .where(
      and(
        eq(resourcePermissions.id, permissionId),
        eq(resourcePermissions.workspaceId, workspaceId),
        eq(resourcePermissions.resourceType, resourceType),
        eq(resourcePermissions.resourceId, resourceId),
      ),
    )
    .returning()

  if (!grant) {
    res.status(404).json({ error: 'Permission grant not found' })
    return
  }

  await db.insert(auditEvents).values({
    actorUserId,
    action: `${resourceType}.permission_revoked`,
    workspaceId,
    metadata: JSON.stringify({ resourceId, targetUserId: grant.userId, level: grant.level }),
  })

  await appendActivity(db, {
    workspaceId,
    actorUserId,
    eventType: `${resourceType}.permission_revoked`,
    entityType: resourceType,
    entityId: resourceId,
    summary: `${resource.name} access was revoked`,
    metadata: { resourceType, resourceId, targetUserId: grant.userId, level: grant.level },
  })

  await enqueueOutboxEvent(db, {
    eventType: 'cache.invalidate',
    aggregateType: resourceType,
    aggregateId: resourceId,
    workspaceId,
    actorUserId,
    payload: { patterns: [cacheKeys.resourceGrant(workspaceId, resourceType, resourceId, grant.userId)] },
    idempotencyKey: `cache:grant-revoke:${workspaceId}:${resourceType}:${resourceId}:${grant.userId}:${grant.id}`,
    jobType: 'cache.invalidate',
    maxAttempts: 3,
  })
  await invalidateCachePatterns([cacheKeys.resourceGrant(workspaceId, resourceType, resourceId, grant.userId)])
  res.json({ grant })
})
