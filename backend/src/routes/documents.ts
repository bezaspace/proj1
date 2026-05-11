import { Router } from 'express'
import { and, desc, eq, inArray, isNull, max } from 'drizzle-orm'
import { db } from '../db/index.js'
import { auditEvents, documentVersions, documents, resourcePermissions } from '../db/schema.js'
import { appendActivity } from '../lib/activity.js'
import { rateLimit } from '../lib/rate-limit.js'
import { getEffectiveResourcePermission, requireResourcePermission, requireWorkspaceRole } from '../lib/workspace-access.js'
import { requireAuth } from '../middleware/auth.js'

export const documentsRouter = Router()

documentsRouter.use(requireAuth)

function normalizeTitle(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeContent(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function documentListFields() {
  return {
    id: documents.id,
    workspaceId: documents.workspaceId,
    title: documents.title,
    content: documents.content,
    createdByUserId: documents.createdByUserId,
    updatedByUserId: documents.updatedByUserId,
    archivedAt: documents.archivedAt,
    createdAt: documents.createdAt,
    updatedAt: documents.updatedAt,
  }
}

async function getVisibleDocument(workspaceId: string, documentId: string) {
  const [document] = await db
    .select(documentListFields())
    .from(documents)
    .where(and(eq(documents.workspaceId, workspaceId), eq(documents.id, documentId), isNull(documents.archivedAt)))
    .limit(1)

  return document ?? null
}

async function serializeDocumentForUser(userId: string, document: Awaited<ReturnType<typeof getVisibleDocument>>) {
  if (!document) {
    return null
  }

  const permission = await getEffectiveResourcePermission(userId, document.workspaceId, 'document', document.id)

  if (!permission) {
    return null
  }

  return {
    ...document,
    effectivePermission: permission.level,
    sharedWithMe: permission.sharedWithMe,
  }
}

documentsRouter.get('/workspaces/:workspaceId/documents', async (req, res) => {
  const userId = req.auth!.user.id
  const { workspaceId } = req.params
  const access = await requireWorkspaceRole(userId, workspaceId)

  if (!access.ok) {
    res.status(access.status).json({ error: access.error })
    return
  }

  const documentIds =
    access.membership.role === 'viewer'
      ? (
          await db
            .select({ resourceId: resourcePermissions.resourceId })
            .from(resourcePermissions)
            .where(
              and(
                eq(resourcePermissions.workspaceId, workspaceId),
                eq(resourcePermissions.resourceType, 'document'),
                eq(resourcePermissions.userId, userId),
              ),
            )
        ).map((grant) => grant.resourceId)
      : null

  if (documentIds && documentIds.length === 0) {
    res.json({ documents: [] })
    return
  }

  const rows = await db
    .select(documentListFields())
    .from(documents)
    .where(
      documentIds
        ? and(eq(documents.workspaceId, workspaceId), inArray(documents.id, documentIds), isNull(documents.archivedAt))
        : and(eq(documents.workspaceId, workspaceId), isNull(documents.archivedAt)),
    )
    .orderBy(desc(documents.updatedAt))

  const serializedRows = (await Promise.all(rows.map((document) => serializeDocumentForUser(userId, document)))).filter(
    Boolean,
  )

  res.json({ documents: serializedRows })
})

documentsRouter.post('/workspaces/:workspaceId/documents', rateLimit({ keyPrefix: 'document_create', limit: 60, windowSeconds: 60 }), async (req, res) => {
  const userId = req.auth!.user.id
  const { workspaceId } = req.params
  const title = normalizeTitle(req.body?.title) || 'Untitled document'
  const content = normalizeContent(req.body?.content)
  const access = await requireWorkspaceRole(userId, workspaceId, 'member')

  if (!access.ok) {
    res.status(access.status).json({ error: access.error })
    return
  }

  if (title.length > 120) {
    res.status(400).json({ error: 'Document title must be 120 characters or fewer.' })
    return
  }

  const document = await db.transaction(async (tx) => {
    const [createdDocument] = await tx
      .insert(documents)
      .values({
        workspaceId,
        title,
        content,
        createdByUserId: userId,
        updatedByUserId: userId,
      })
      .returning()

    await tx.insert(documentVersions).values({
      documentId: createdDocument.id,
      versionNumber: 1,
      title: createdDocument.title,
      content: createdDocument.content,
      editorUserId: userId,
    })

    await tx.insert(resourcePermissions).values({
      workspaceId,
      resourceType: 'document',
      resourceId: createdDocument.id,
      userId,
      level: 'owner',
      grantedByUserId: userId,
    })

    await tx.insert(auditEvents).values({
      actorUserId: userId,
      action: 'document.created',
      workspaceId,
      metadata: JSON.stringify({ documentId: createdDocument.id, title }),
    })

    await appendActivity(tx, {
      workspaceId,
      actorUserId: userId,
      eventType: 'document.created',
      entityType: 'document',
      entityId: createdDocument.id,
      summary: `Document "${createdDocument.title}" was created`,
      metadata: { title: createdDocument.title },
    })

    return createdDocument
  })

  res.status(201).json({ document: { ...document, effectivePermission: 'owner', sharedWithMe: false } })
})

documentsRouter.get('/workspaces/:workspaceId/documents/:documentId', async (req, res) => {
  const userId = req.auth!.user.id
  const { workspaceId, documentId } = req.params
  const access = await requireWorkspaceRole(userId, workspaceId)

  if (!access.ok) {
    res.status(access.status).json({ error: access.error })
    return
  }

  const document = await getVisibleDocument(workspaceId, documentId)

  if (!document) {
    res.status(404).json({ error: 'Document not found' })
    return
  }

  const permission = await requireResourcePermission(userId, workspaceId, 'document', documentId)

  if (!permission.ok) {
    res.status(permission.status).json({ error: permission.error })
    return
  }

  res.json({
    document: { ...document, effectivePermission: permission.level, sharedWithMe: Boolean(permission.grant && permission.grant.level !== 'owner') },
  })
})

documentsRouter.get('/workspaces/:workspaceId/documents/:documentId/versions', async (req, res) => {
  const userId = req.auth!.user.id
  const { workspaceId, documentId } = req.params
  const access = await requireWorkspaceRole(userId, workspaceId)

  if (!access.ok) {
    res.status(access.status).json({ error: access.error })
    return
  }

  const document = await getVisibleDocument(workspaceId, documentId)

  if (!document) {
    res.status(404).json({ error: 'Document not found' })
    return
  }

  const permission = await requireResourcePermission(userId, workspaceId, 'document', documentId)

  if (!permission.ok) {
    res.status(permission.status).json({ error: permission.error })
    return
  }

  const versions = await db
    .select({
      id: documentVersions.id,
      documentId: documentVersions.documentId,
      versionNumber: documentVersions.versionNumber,
      title: documentVersions.title,
      content: documentVersions.content,
      editorUserId: documentVersions.editorUserId,
      createdAt: documentVersions.createdAt,
    })
    .from(documentVersions)
    .where(eq(documentVersions.documentId, documentId))
    .orderBy(desc(documentVersions.versionNumber))

  res.json({ versions })
})

documentsRouter.patch(
  '/workspaces/:workspaceId/documents/:documentId',
  rateLimit({ keyPrefix: 'document_update', limit: 120, windowSeconds: 60 }),
  async (req, res) => {
  const userId = req.auth!.user.id
  const { workspaceId, documentId } = req.params
  const workspaceAccess = await requireWorkspaceRole(userId, workspaceId)

  if (!workspaceAccess.ok) {
    res.status(workspaceAccess.status).json({ error: workspaceAccess.error })
    return
  }

  const existingDocument = await getVisibleDocument(workspaceId, documentId)

  if (!existingDocument) {
    res.status(404).json({ error: 'Document not found' })
    return
  }

  const access = await requireResourcePermission(userId, workspaceId, 'document', documentId, 'edit')

  if (!access.ok) {
    res.status(access.status).json({ error: access.error })
    return
  }

  const title = req.body?.title === undefined ? existingDocument.title : normalizeTitle(req.body.title)
  const content = req.body?.content === undefined ? existingDocument.content : normalizeContent(req.body.content)

  if (title.length < 1 || title.length > 120) {
    res.status(400).json({ error: 'Document title must be between 1 and 120 characters.' })
    return
  }

  const document = await db.transaction(async (tx) => {
    const [versionRow] = await tx
      .select({ value: max(documentVersions.versionNumber) })
      .from(documentVersions)
      .where(eq(documentVersions.documentId, documentId))

    const nextVersion = Number(versionRow?.value ?? 0) + 1

    const [updatedDocument] = await tx
      .update(documents)
      .set({
        title,
        content,
        crdtState: null,
        updatedByUserId: userId,
        updatedAt: new Date(),
      })
      .where(and(eq(documents.workspaceId, workspaceId), eq(documents.id, documentId), isNull(documents.archivedAt)))
      .returning()

    await tx.insert(documentVersions).values({
      documentId,
      versionNumber: nextVersion,
      title: updatedDocument.title,
      content: updatedDocument.content,
      editorUserId: userId,
    })

    await tx.insert(auditEvents).values({
      actorUserId: userId,
      action: 'document.updated',
      workspaceId,
      metadata: JSON.stringify({ documentId, versionNumber: nextVersion }),
    })

    await appendActivity(tx, {
      workspaceId,
      actorUserId: userId,
      eventType: 'document.updated',
      entityType: 'document',
      entityId: documentId,
      summary: `Document "${updatedDocument.title}" was saved`,
      metadata: { versionNumber: nextVersion, title: updatedDocument.title },
    })

    return updatedDocument
  })

  res.json({
    document: { ...document, effectivePermission: access.level, sharedWithMe: Boolean(access.grant && access.grant.level !== 'owner') },
  })
  },
)

documentsRouter.delete('/workspaces/:workspaceId/documents/:documentId', async (req, res) => {
  const userId = req.auth!.user.id
  const { workspaceId, documentId } = req.params
  const workspaceAccess = await requireWorkspaceRole(userId, workspaceId)

  if (!workspaceAccess.ok) {
    res.status(workspaceAccess.status).json({ error: workspaceAccess.error })
    return
  }

  const existingDocument = await getVisibleDocument(workspaceId, documentId)

  if (!existingDocument) {
    res.status(404).json({ error: 'Document not found' })
    return
  }

  const access = await requireResourcePermission(userId, workspaceId, 'document', documentId, 'owner')

  if (!access.ok) {
    res.status(access.status).json({ error: access.error })
    return
  }

  const document = await db.transaction(async (tx) => {
    const [versionRow] = await tx
      .select({ value: max(documentVersions.versionNumber) })
      .from(documentVersions)
      .where(eq(documentVersions.documentId, documentId))

    const nextVersion = Number(versionRow?.value ?? 0) + 1

    const [archivedDocument] = await tx
      .update(documents)
      .set({
        archivedAt: new Date(),
        updatedByUserId: userId,
        updatedAt: new Date(),
      })
      .where(and(eq(documents.workspaceId, workspaceId), eq(documents.id, documentId), isNull(documents.archivedAt)))
      .returning()

    await tx.insert(documentVersions).values({
      documentId,
      versionNumber: nextVersion,
      title: archivedDocument.title,
      content: archivedDocument.content,
      editorUserId: userId,
    })

    await tx.insert(auditEvents).values({
      actorUserId: userId,
      action: 'document.archived',
      workspaceId,
      metadata: JSON.stringify({ documentId, versionNumber: nextVersion }),
    })

    await appendActivity(tx, {
      workspaceId,
      actorUserId: userId,
      eventType: 'document.archived',
      entityType: 'document',
      entityId: documentId,
      summary: `Document "${archivedDocument.title}" was archived`,
      metadata: { versionNumber: nextVersion, title: archivedDocument.title },
    })

    return archivedDocument
  })

  res.json({
    document: { ...document, effectivePermission: access.level, sharedWithMe: Boolean(access.grant && access.grant.level !== 'owner') },
  })
})
