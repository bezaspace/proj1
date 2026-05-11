import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { Router } from 'express'
import { and, eq, gt, isNull, or, sql } from 'drizzle-orm'
import { db } from '../db/index.js'
import { auditEvents, documents, fileVersions, files, publicShareLinks } from '../db/schema.js'
import { appendActivity } from '../lib/activity.js'
import { createDownloadUrl } from '../lib/object-storage.js'
import { rateLimit } from '../lib/rate-limit.js'
import { requireResourcePermission, requireWorkspaceRole, type ResourceType } from '../lib/workspace-access.js'
import { requireAuth } from '../middleware/auth.js'

export const shareLinksRouter = Router()
export const publicShareRouter = Router()

const tokenBytes = 12

function normalizeResourceType(value: unknown): ResourceType | null {
  return value === 'document' || value === 'file' ? value : null
}

function normalizePassword(value: unknown) {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function normalizeDate(value: unknown) {
  if (!value) {
    return null
  }

  const date = new Date(String(value))
  return Number.isNaN(date.getTime()) ? null : date
}

function createToken() {
  return randomBytes(tokenBytes).toString('base64url')
}

function hashPassword(password: string) {
  const salt = randomBytes(16).toString('base64url')
  const hash = scryptSync(password, salt, 32).toString('base64url')
  return `scrypt:${salt}:${hash}`
}

function verifyPassword(password: string, encoded: string) {
  const [, salt, storedHash] = encoded.split(':')

  if (!salt || !storedHash) {
    return false
  }

  const actual = scryptSync(password, salt, 32)
  const expected = Buffer.from(storedHash, 'base64url')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

async function resourceExists(workspaceId: string, resourceType: ResourceType, resourceId: string) {
  if (resourceType === 'document') {
    const [document] = await db
      .select({ id: documents.id, name: documents.title })
      .from(documents)
      .where(and(eq(documents.workspaceId, workspaceId), eq(documents.id, resourceId), isNull(documents.archivedAt)))
      .limit(1)

    return document ?? null
  }

  const [file] = await db
    .select({ id: files.id, name: files.name })
    .from(files)
    .where(and(eq(files.workspaceId, workspaceId), eq(files.id, resourceId), isNull(files.archivedAt)))
    .limit(1)

  return file ?? null
}

async function getActivePublicLink(token: string) {
  const [link] = await db
    .select()
    .from(publicShareLinks)
    .where(
      and(
        eq(publicShareLinks.token, token),
        isNull(publicShareLinks.revokedAt),
        or(isNull(publicShareLinks.expiresAt), gt(publicShareLinks.expiresAt, new Date())),
      ),
    )
    .limit(1)

  return link ?? null
}

shareLinksRouter.use(requireAuth)

shareLinksRouter.get('/workspaces/:workspaceId/share-links', async (req, res) => {
  const userId = req.auth!.user.id
  const { workspaceId } = req.params
  const resourceType = normalizeResourceType(req.query.resourceType)
  const resourceId = typeof req.query.resourceId === 'string' ? req.query.resourceId : null
  const access = await requireWorkspaceRole(userId, workspaceId)

  if (!access.ok) {
    res.status(access.status).json({ error: access.error })
    return
  }

  const rows = await db
    .select()
    .from(publicShareLinks)
    .where(
      resourceType && resourceId
        ? and(
            eq(publicShareLinks.workspaceId, workspaceId),
            eq(publicShareLinks.resourceType, resourceType),
            eq(publicShareLinks.resourceId, resourceId),
          )
        : eq(publicShareLinks.workspaceId, workspaceId),
    )
    .orderBy(sql`${publicShareLinks.createdAt} desc`)

  res.json({ links: rows.map((link) => ({ ...link, passwordHash: link.passwordHash ? 'set' : null })) })
})

shareLinksRouter.post(
  '/workspaces/:workspaceId/share-links',
  rateLimit({ keyPrefix: 'public_share_link_create', limit: 30, windowSeconds: 60 }),
  async (req, res) => {
    const userId = req.auth!.user.id
    const { workspaceId } = req.params
    const resourceType = normalizeResourceType(req.body?.resourceType)
    const resourceId = typeof req.body?.resourceId === 'string' ? req.body.resourceId : ''
    const password = normalizePassword(req.body?.password)
    const expiresAt = normalizeDate(req.body?.expiresAt)
    const access = await requireWorkspaceRole(userId, workspaceId)

    if (!access.ok) {
      res.status(access.status).json({ error: access.error })
      return
    }

    if (!resourceType || !resourceId) {
      res.status(400).json({ error: 'resourceType and resourceId are required.' })
      return
    }

    const permission = await requireResourcePermission(userId, workspaceId, resourceType, resourceId, 'edit')

    if (!permission.ok) {
      res.status(permission.status).json({ error: permission.error })
      return
    }

    const resource = await resourceExists(workspaceId, resourceType, resourceId)

    if (!resource) {
      res.status(404).json({ error: 'Resource not found' })
      return
    }

    const link = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(publicShareLinks)
        .values({
          workspaceId,
          resourceType,
          resourceId,
          token: createToken(),
          passwordHash: password ? hashPassword(password) : null,
          expiresAt,
          createdByUserId: userId,
        })
        .returning()

      await tx.insert(auditEvents).values({
        actorUserId: userId,
        action: 'public_share_link.created',
        workspaceId,
        metadata: JSON.stringify({ linkId: created.id, resourceType, resourceId, expiresAt }),
      })

      await appendActivity(tx, {
        workspaceId,
        actorUserId: userId,
        eventType: 'public_share_link.created',
        entityType: resourceType,
        entityId: resourceId,
        summary: `Public link created for ${resourceType} "${resource.name}"`,
        metadata: { linkId: created.id, resourceType, resourceId, hasPassword: Boolean(password), expiresAt },
      })

      return created
    })

    res.status(201).json({ link: { ...link, passwordHash: link.passwordHash ? 'set' : null } })
  },
)

shareLinksRouter.delete('/workspaces/:workspaceId/share-links/:linkId', async (req, res) => {
  const userId = req.auth!.user.id
  const { workspaceId, linkId } = req.params
  const access = await requireWorkspaceRole(userId, workspaceId)

  if (!access.ok) {
    res.status(access.status).json({ error: access.error })
    return
  }

  const [link] = await db
    .select()
    .from(publicShareLinks)
    .where(and(eq(publicShareLinks.workspaceId, workspaceId), eq(publicShareLinks.id, linkId)))
    .limit(1)

  if (!link) {
    res.status(404).json({ error: 'Public link not found' })
    return
  }

  const permission = await requireResourcePermission(userId, workspaceId, link.resourceType, link.resourceId, 'edit')

  if (!permission.ok) {
    res.status(permission.status).json({ error: permission.error })
    return
  }

  const [revoked] = await db
    .update(publicShareLinks)
    .set({ revokedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(publicShareLinks.workspaceId, workspaceId), eq(publicShareLinks.id, linkId), isNull(publicShareLinks.revokedAt)))
    .returning()

  res.json({ link: revoked ?? link })
})

publicShareRouter.get(
  '/public/shares/:token',
  rateLimit({ keyPrefix: 'public_share_access', limit: 120, windowSeconds: 60 }, (req) => req.ip ?? 'unknown'),
  async (req, res) => {
    const { token } = req.params
    const password = normalizePassword(req.query.password)
    const link = await getActivePublicLink(token)

    if (!link) {
      res.status(404).json({ error: 'Public link not found' })
      return
    }

    if (link.passwordHash && (!password || !verifyPassword(password, link.passwordHash))) {
      res.status(403).json({ error: 'Password required.' })
      return
    }

    const resource = await resourceExists(link.workspaceId, link.resourceType, link.resourceId)

    if (!resource) {
      res.status(404).json({ error: 'Shared resource not found' })
      return
    }

    await db
      .update(publicShareLinks)
      .set({ accessCount: sql`${publicShareLinks.accessCount} + 1`, lastAccessedAt: new Date(), updatedAt: new Date() })
      .where(eq(publicShareLinks.id, link.id))

    if (link.resourceType === 'document') {
      const [document] = await db
        .select({ id: documents.id, title: documents.title, content: documents.content, updatedAt: documents.updatedAt })
        .from(documents)
        .where(and(eq(documents.workspaceId, link.workspaceId), eq(documents.id, link.resourceId), isNull(documents.archivedAt)))
        .limit(1)

      res.json({ resourceType: 'document', document, requiresPassword: Boolean(link.passwordHash) })
      return
    }

    res.json({ resourceType: 'file', file: resource, requiresPassword: Boolean(link.passwordHash) })
  },
)

publicShareRouter.get(
  '/public/shares/:token/download',
  rateLimit({ keyPrefix: 'public_share_download', limit: 60, windowSeconds: 60 }, (req) => req.ip ?? 'unknown'),
  async (req, res) => {
    const { token } = req.params
    const password = normalizePassword(req.query.password)
    const link = await getActivePublicLink(token)

    if (!link || link.resourceType !== 'file') {
      res.status(404).json({ error: 'Public file link not found' })
      return
    }

    if (link.passwordHash && (!password || !verifyPassword(password, link.passwordHash))) {
      res.status(403).json({ error: 'Password required.' })
      return
    }

    const [file] = await db
      .select()
      .from(files)
      .where(and(eq(files.workspaceId, link.workspaceId), eq(files.id, link.resourceId), isNull(files.archivedAt)))
      .limit(1)

    if (!file || file.uploadStatus !== 'uploaded') {
      res.status(404).json({ error: 'Shared file not found' })
      return
    }

    const [version] = await db
      .select()
      .from(fileVersions)
      .where(and(eq(fileVersions.fileId, file.id), eq(fileVersions.versionNumber, file.latestVersionNumber)))
      .limit(1)

    if (!version || version.uploadStatus !== 'uploaded') {
      res.status(404).json({ error: 'Uploaded version not found' })
      return
    }

    await db
      .update(publicShareLinks)
      .set({ accessCount: sql`${publicShareLinks.accessCount} + 1`, lastAccessedAt: new Date(), updatedAt: new Date() })
      .where(eq(publicShareLinks.id, link.id))

    const downloadUrl = await createDownloadUrl(version.objectKey, file.name)
    res.json({ downloadUrl, expiresInSeconds: 600 })
  },
)
