import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import { and, desc, eq, inArray, isNull, max } from 'drizzle-orm'
import { db } from '../db/index.js'
import { auditEvents, fileVersions, files, folders, resourcePermissions } from '../db/schema.js'
import { env } from '../env.js'
import { createDownloadUrl, createUploadUrl, statStoredObject } from '../lib/object-storage.js'
import { getEffectiveResourcePermission, requireResourcePermission, requireWorkspaceRole } from '../lib/workspace-access.js'
import { requireAuth } from '../middleware/auth.js'

export const filesRouter = Router()

filesRouter.use(requireAuth)

const rootFolderId = '00000000-0000-0000-0000-000000000000'

function normalizeName(value: unknown) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''
}

function normalizeMimeType(value: unknown) {
  const mimeType = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return mimeType || 'application/octet-stream'
}

function normalizeChecksum(value: unknown) {
  const checksum = typeof value === 'string' ? value.trim() : ''
  return checksum || null
}

function normalizeFolderId(value: unknown) {
  if (value === null || value === undefined || value === '') {
    return null
  }

  return typeof value === 'string' ? value : null
}

function normalizeSizeBytes(value: unknown) {
  const sizeBytes = Number(value)

  if (!Number.isInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > env.maxUploadBytes) {
    return null
  }

  return sizeBytes
}

function normalizeLimit(value: unknown) {
  const limit = Number(value)

  if (!Number.isInteger(limit) || limit < 1) {
    return 50
  }

  return Math.min(limit, 100)
}

function normalizeCursor(value: unknown) {
  const cursor = Number(value)

  if (!Number.isInteger(cursor) || cursor < 0) {
    return 0
  }

  return cursor
}

function folderListFields() {
  return {
    id: folders.id,
    workspaceId: folders.workspaceId,
    parentFolderId: folders.parentFolderId,
    name: folders.name,
    createdByUserId: folders.createdByUserId,
    updatedByUserId: folders.updatedByUserId,
    archivedAt: folders.archivedAt,
    createdAt: folders.createdAt,
    updatedAt: folders.updatedAt,
  }
}

function fileListFields() {
  return {
    id: files.id,
    workspaceId: files.workspaceId,
    folderId: files.folderId,
    name: files.name,
    mimeType: files.mimeType,
    sizeBytes: files.sizeBytes,
    checksum: files.checksum,
    uploadStatus: files.uploadStatus,
    latestVersionNumber: files.latestVersionNumber,
    createdByUserId: files.createdByUserId,
    updatedByUserId: files.updatedByUserId,
    archivedAt: files.archivedAt,
    createdAt: files.createdAt,
    updatedAt: files.updatedAt,
  }
}

function versionListFields() {
  return {
    id: fileVersions.id,
    fileId: fileVersions.fileId,
    versionNumber: fileVersions.versionNumber,
    objectKey: fileVersions.objectKey,
    mimeType: fileVersions.mimeType,
    sizeBytes: fileVersions.sizeBytes,
    checksum: fileVersions.checksum,
    uploadStatus: fileVersions.uploadStatus,
    createdByUserId: fileVersions.createdByUserId,
    createdAt: fileVersions.createdAt,
  }
}

function parentFolderCondition(workspaceId: string, folderId: string | null) {
  return folderId
    ? and(eq(folders.workspaceId, workspaceId), eq(folders.parentFolderId, folderId), isNull(folders.archivedAt))
    : and(eq(folders.workspaceId, workspaceId), isNull(folders.parentFolderId), isNull(folders.archivedAt))
}

function fileFolderCondition(workspaceId: string, folderId: string | null) {
  return folderId
    ? and(eq(files.workspaceId, workspaceId), eq(files.folderId, folderId), isNull(files.archivedAt))
    : and(eq(files.workspaceId, workspaceId), isNull(files.folderId), isNull(files.archivedAt))
}

async function getVisibleFolder(workspaceId: string, folderId: string) {
  const [folder] = await db
    .select(folderListFields())
    .from(folders)
    .where(and(eq(folders.workspaceId, workspaceId), eq(folders.id, folderId), isNull(folders.archivedAt)))
    .limit(1)

  return folder ?? null
}

async function getVisibleFile(workspaceId: string, fileId: string) {
  const [file] = await db
    .select(fileListFields())
    .from(files)
    .where(and(eq(files.workspaceId, workspaceId), eq(files.id, fileId), isNull(files.archivedAt)))
    .limit(1)

  return file ?? null
}

async function serializeFileForUser(userId: string, file: Awaited<ReturnType<typeof getVisibleFile>>) {
  if (!file) {
    return null
  }

  const permission = await getEffectiveResourcePermission(userId, file.workspaceId, 'file', file.id)

  if (!permission) {
    return null
  }

  return {
    ...file,
    effectivePermission: permission.level,
    sharedWithMe: permission.sharedWithMe,
  }
}

async function ensureFolderTarget(workspaceId: string, folderId: string | null) {
  if (!folderId) {
    return true
  }

  return Boolean(await getVisibleFolder(workspaceId, folderId))
}

function sendConstraintError(res: { status: (code: number) => { json: (body: unknown) => void } }, error: unknown) {
  if (typeof error === 'object' && error && 'code' in error && error.code === '23505') {
    res.status(409).json({ error: 'A folder or file with that name already exists here.' })
    return true
  }

  return false
}

function getStatMimeType(stat: Awaited<ReturnType<typeof statStoredObject>>) {
  const metadata = stat.metaData as Record<string, unknown> | undefined
  const value = metadata?.['content-type'] ?? metadata?.['Content-Type']
  return typeof value === 'string' ? value.toLowerCase() : null
}

function createObjectKey(workspaceId: string, fileId: string, versionNumber: number, fileName: string) {
  const extension = fileName.includes('.') ? fileName.split('.').pop() : null
  const suffix = extension ? `.${extension.replace(/[^a-z0-9]/gi, '').slice(0, 12)}` : ''
  return `workspaces/${workspaceId}/files/${fileId}/versions/${versionNumber}/${randomUUID()}${suffix}`
}

async function collectFolderSubtreeIds(workspaceId: string, folderId: string) {
  const ids = [folderId]
  const queue = [folderId]

  while (queue.length) {
    const parentId = queue.shift()!
    const children = await db
      .select({ id: folders.id })
      .from(folders)
      .where(and(eq(folders.workspaceId, workspaceId), eq(folders.parentFolderId, parentId), isNull(folders.archivedAt)))

    for (const child of children) {
      ids.push(child.id)
      queue.push(child.id)
    }
  }

  return ids
}

filesRouter.get('/workspaces/:workspaceId/drive', async (req, res) => {
  const userId = req.auth!.user.id
  const { workspaceId } = req.params
  const folderId = normalizeFolderId(req.query.folderId)
  const limit = normalizeLimit(req.query.limit)
  const cursor = normalizeCursor(req.query.cursor)
  const access = await requireWorkspaceRole(userId, workspaceId)

  if (!access.ok) {
    res.status(access.status).json({ error: access.error })
    return
  }

  if (!(await ensureFolderTarget(workspaceId, folderId))) {
    res.status(404).json({ error: 'Folder not found' })
    return
  }

  if (access.membership.role === 'viewer' && folderId) {
    res.status(403).json({ error: 'Shared files are listed at the root of your drive view.' })
    return
  }

  const sharedFileIds =
    access.membership.role === 'viewer'
      ? (
          await db
            .select({ resourceId: resourcePermissions.resourceId })
            .from(resourcePermissions)
            .where(
              and(
                eq(resourcePermissions.workspaceId, workspaceId),
                eq(resourcePermissions.resourceType, 'file'),
                eq(resourcePermissions.userId, userId),
              ),
            )
        ).map((grant) => grant.resourceId)
      : null

  if (sharedFileIds && sharedFileIds.length === 0) {
    res.json({ currentFolderId: folderId, folders: [], files: [], nextCursor: null })
    return
  }

  const [folderRows, fileRows] = await Promise.all([
    sharedFileIds
      ? Promise.resolve([])
      : db
          .select(folderListFields())
          .from(folders)
          .where(parentFolderCondition(workspaceId, folderId))
          .orderBy(desc(folders.updatedAt)),
    db
      .select(fileListFields())
      .from(files)
      .where(
        sharedFileIds
          ? and(eq(files.workspaceId, workspaceId), inArray(files.id, sharedFileIds), isNull(files.archivedAt))
          : fileFolderCondition(workspaceId, folderId),
      )
      .orderBy(desc(files.updatedAt))
      .limit(limit + 1)
      .offset(cursor),
  ])

  const hasMore = fileRows.length > limit
  const pageFiles = hasMore ? fileRows.slice(0, limit) : fileRows
  const serializedFiles = (await Promise.all(pageFiles.map((file) => serializeFileForUser(userId, file)))).filter(
    Boolean,
  )

  res.json({
    currentFolderId: folderId,
    folders: folderRows,
    files: serializedFiles,
    nextCursor: hasMore ? cursor + limit : null,
  })
})

filesRouter.post('/workspaces/:workspaceId/folders', async (req, res) => {
  const userId = req.auth!.user.id
  const { workspaceId } = req.params
  const name = normalizeName(req.body?.name)
  const parentFolderId = normalizeFolderId(req.body?.parentFolderId)
  const access = await requireWorkspaceRole(userId, workspaceId, 'member')

  if (!access.ok) {
    res.status(access.status).json({ error: access.error })
    return
  }

  if (name.length < 1 || name.length > 120) {
    res.status(400).json({ error: 'Folder name must be between 1 and 120 characters.' })
    return
  }

  if (!(await ensureFolderTarget(workspaceId, parentFolderId))) {
    res.status(404).json({ error: 'Parent folder not found' })
    return
  }

  try {
    const folder = await db.transaction(async (tx) => {
      const [createdFolder] = await tx
        .insert(folders)
        .values({
          workspaceId,
          parentFolderId,
          name,
          createdByUserId: userId,
          updatedByUserId: userId,
        })
        .returning()

      await tx.insert(auditEvents).values({
        actorUserId: userId,
        action: 'folder.created',
        workspaceId,
        metadata: JSON.stringify({ folderId: createdFolder.id, parentFolderId, name }),
      })

      return createdFolder
    })

    res.status(201).json({ folder })
  } catch (error) {
    if (sendConstraintError(res, error)) {
      return
    }

    throw error
  }
})

filesRouter.patch('/workspaces/:workspaceId/folders/:folderId', async (req, res) => {
  const userId = req.auth!.user.id
  const { workspaceId, folderId } = req.params
  const name = normalizeName(req.body?.name)
  const access = await requireWorkspaceRole(userId, workspaceId, 'member')

  if (!access.ok) {
    res.status(access.status).json({ error: access.error })
    return
  }

  if (name.length < 1 || name.length > 120) {
    res.status(400).json({ error: 'Folder name must be between 1 and 120 characters.' })
    return
  }

  const existingFolder = await getVisibleFolder(workspaceId, folderId)

  if (!existingFolder) {
    res.status(404).json({ error: 'Folder not found' })
    return
  }

  try {
    const folder = await db.transaction(async (tx) => {
      const [updatedFolder] = await tx
        .update(folders)
        .set({ name, updatedByUserId: userId, updatedAt: new Date() })
        .where(and(eq(folders.workspaceId, workspaceId), eq(folders.id, folderId), isNull(folders.archivedAt)))
        .returning()

      await tx.insert(auditEvents).values({
        actorUserId: userId,
        action: 'folder.updated',
        workspaceId,
        metadata: JSON.stringify({ folderId, name }),
      })

      return updatedFolder
    })

    res.json({ folder })
  } catch (error) {
    if (sendConstraintError(res, error)) {
      return
    }

    throw error
  }
})

filesRouter.delete('/workspaces/:workspaceId/folders/:folderId', async (req, res) => {
  const userId = req.auth!.user.id
  const { workspaceId, folderId } = req.params
  const access = await requireWorkspaceRole(userId, workspaceId, 'member')

  if (!access.ok) {
    res.status(access.status).json({ error: access.error })
    return
  }

  const existingFolder = await getVisibleFolder(workspaceId, folderId)

  if (!existingFolder) {
    res.status(404).json({ error: 'Folder not found' })
    return
  }

  const folderIds = await collectFolderSubtreeIds(workspaceId, folderId)
  const archivedAt = new Date()

  await db.transaction(async (tx) => {
    await tx
      .update(folders)
      .set({ archivedAt, updatedByUserId: userId, updatedAt: archivedAt })
      .where(and(eq(folders.workspaceId, workspaceId), inArray(folders.id, folderIds), isNull(folders.archivedAt)))

    await tx
      .update(files)
      .set({ archivedAt, updatedByUserId: userId, updatedAt: archivedAt })
      .where(and(eq(files.workspaceId, workspaceId), inArray(files.folderId, folderIds), isNull(files.archivedAt)))

    await tx.insert(auditEvents).values({
      actorUserId: userId,
      action: 'folder.archived',
      workspaceId,
      metadata: JSON.stringify({ folderId, archivedFolderCount: folderIds.length }),
    })
  })

  res.json({ archivedFolderIds: folderIds })
})

filesRouter.post('/workspaces/:workspaceId/files/upload-intents', async (req, res) => {
  const userId = req.auth!.user.id
  const { workspaceId } = req.params
  const name = normalizeName(req.body?.name)
  const folderId = normalizeFolderId(req.body?.folderId)
  const mimeType = normalizeMimeType(req.body?.mimeType)
  const sizeBytes = normalizeSizeBytes(req.body?.sizeBytes)
  const checksum = normalizeChecksum(req.body?.checksum)
  const access = await requireWorkspaceRole(userId, workspaceId, 'member')

  if (!access.ok) {
    res.status(access.status).json({ error: access.error })
    return
  }

  if (name.length < 1 || name.length > 180) {
    res.status(400).json({ error: 'File name must be between 1 and 180 characters.' })
    return
  }

  if (!sizeBytes) {
    res.status(400).json({ error: `File must be between 1 byte and ${env.maxUploadBytes} bytes.` })
    return
  }

  if (!(await ensureFolderTarget(workspaceId, folderId))) {
    res.status(404).json({ error: 'Folder not found' })
    return
  }

  try {
    const payload = await db.transaction(async (tx) => {
      const [createdFile] = await tx
        .insert(files)
        .values({
          workspaceId,
          folderId,
          name,
          mimeType,
          sizeBytes: 0,
          checksum,
          uploadStatus: 'pending',
          latestVersionNumber: 0,
          createdByUserId: userId,
          updatedByUserId: userId,
        })
        .returning()

      const objectKey = createObjectKey(workspaceId, createdFile.id, 1, name)
      const [createdVersion] = await tx
        .insert(fileVersions)
        .values({
          fileId: createdFile.id,
          versionNumber: 1,
          objectKey,
          mimeType,
          sizeBytes,
          checksum,
          uploadStatus: 'pending',
          createdByUserId: userId,
        })
        .returning()

      await tx.insert(resourcePermissions).values({
        workspaceId,
        resourceType: 'file',
        resourceId: createdFile.id,
        userId,
        level: 'owner',
        grantedByUserId: userId,
      })

      await tx.insert(auditEvents).values({
        actorUserId: userId,
        action: 'file.upload_intent.created',
        workspaceId,
        metadata: JSON.stringify({ fileId: createdFile.id, versionId: createdVersion.id, folderId, name }),
      })

      return { file: { ...createdFile, effectivePermission: 'owner', sharedWithMe: false }, version: createdVersion }
    })

    const uploadUrl = await createUploadUrl(payload.version.objectKey)

    res.status(201).json({ ...payload, uploadUrl, expiresInSeconds: 900, maxUploadBytes: env.maxUploadBytes })
  } catch (error) {
    if (sendConstraintError(res, error)) {
      return
    }

    throw error
  }
})

filesRouter.post('/workspaces/:workspaceId/files/:fileId/replacement-upload-intents', async (req, res) => {
  const userId = req.auth!.user.id
  const { workspaceId, fileId } = req.params
  const mimeType = normalizeMimeType(req.body?.mimeType)
  const sizeBytes = normalizeSizeBytes(req.body?.sizeBytes)
  const checksum = normalizeChecksum(req.body?.checksum)
  const workspaceAccess = await requireWorkspaceRole(userId, workspaceId)

  if (!workspaceAccess.ok) {
    res.status(workspaceAccess.status).json({ error: workspaceAccess.error })
    return
  }

  if (!sizeBytes) {
    res.status(400).json({ error: `File must be between 1 byte and ${env.maxUploadBytes} bytes.` })
    return
  }

  const existingFile = await getVisibleFile(workspaceId, fileId)

  if (!existingFile) {
    res.status(404).json({ error: 'File not found' })
    return
  }

  const access = await requireResourcePermission(userId, workspaceId, 'file', fileId, 'edit')

  if (!access.ok) {
    res.status(access.status).json({ error: access.error })
    return
  }

  const payload = await db.transaction(async (tx) => {
    const [versionRow] = await tx
      .select({ value: max(fileVersions.versionNumber) })
      .from(fileVersions)
      .where(eq(fileVersions.fileId, fileId))

    const nextVersion = Number(versionRow?.value ?? 0) + 1
    const objectKey = createObjectKey(workspaceId, fileId, nextVersion, existingFile.name)
    const [createdVersion] = await tx
      .insert(fileVersions)
      .values({
        fileId,
        versionNumber: nextVersion,
        objectKey,
        mimeType,
        sizeBytes,
        checksum,
        uploadStatus: 'pending',
        createdByUserId: userId,
      })
      .returning()

    await tx.insert(auditEvents).values({
      actorUserId: userId,
      action: 'file.replacement_upload_intent.created',
      workspaceId,
      metadata: JSON.stringify({ fileId, versionId: createdVersion.id, versionNumber: nextVersion }),
    })

    return {
      file: { ...existingFile, effectivePermission: access.level, sharedWithMe: Boolean(access.grant && access.grant.level !== 'owner') },
      version: createdVersion,
    }
  })

  const uploadUrl = await createUploadUrl(payload.version.objectKey)

  res.status(201).json({ ...payload, uploadUrl, expiresInSeconds: 900, maxUploadBytes: env.maxUploadBytes })
})

filesRouter.post('/workspaces/:workspaceId/files/:fileId/versions/:versionId/complete', async (req, res) => {
  const userId = req.auth!.user.id
  const { workspaceId, fileId, versionId } = req.params
  const workspaceAccess = await requireWorkspaceRole(userId, workspaceId)

  if (!workspaceAccess.ok) {
    res.status(workspaceAccess.status).json({ error: workspaceAccess.error })
    return
  }

  const existingFile = await getVisibleFile(workspaceId, fileId)

  if (!existingFile) {
    res.status(404).json({ error: 'File not found' })
    return
  }

  const access = await requireResourcePermission(userId, workspaceId, 'file', fileId, 'edit')

  if (!access.ok) {
    res.status(access.status).json({ error: access.error })
    return
  }

  const [pendingVersion] = await db
    .select(versionListFields())
    .from(fileVersions)
    .where(and(eq(fileVersions.fileId, fileId), eq(fileVersions.id, versionId)))
    .limit(1)

  if (!pendingVersion) {
    res.status(404).json({ error: 'File version not found' })
    return
  }

  if (pendingVersion.uploadStatus !== 'pending') {
    res.status(409).json({ error: 'This upload has already been completed or failed.' })
    return
  }

  let stat: Awaited<ReturnType<typeof statStoredObject>>

  try {
    stat = await statStoredObject(pendingVersion.objectKey)
  } catch {
    res.status(409).json({ error: 'Uploaded object was not found in storage.' })
    return
  }

  const statMimeType = getStatMimeType(stat)

  if (stat.size !== pendingVersion.sizeBytes || (statMimeType && statMimeType !== pendingVersion.mimeType)) {
    await db
      .update(fileVersions)
      .set({ uploadStatus: 'failed' })
      .where(and(eq(fileVersions.fileId, fileId), eq(fileVersions.id, versionId), eq(fileVersions.uploadStatus, 'pending')))

    res.status(400).json({ error: 'Uploaded object metadata does not match the upload intent.' })
    return
  }

  const payload = await db.transaction(async (tx) => {
    const [version] = await tx
      .update(fileVersions)
      .set({ uploadStatus: 'uploaded' })
      .where(and(eq(fileVersions.fileId, fileId), eq(fileVersions.id, versionId), eq(fileVersions.uploadStatus, 'pending')))
      .returning()

    const [file] =
      version.versionNumber >= existingFile.latestVersionNumber
        ? await tx
            .update(files)
            .set({
              mimeType: version.mimeType,
              sizeBytes: version.sizeBytes,
              checksum: version.checksum,
              uploadStatus: 'uploaded',
              latestVersionNumber: version.versionNumber,
              updatedByUserId: userId,
              updatedAt: new Date(),
            })
            .where(and(eq(files.workspaceId, workspaceId), eq(files.id, fileId), isNull(files.archivedAt)))
            .returning()
        : [existingFile]

    await tx.insert(auditEvents).values({
      actorUserId: userId,
      action: 'file.upload_completed',
      workspaceId,
      metadata: JSON.stringify({ fileId, versionId, versionNumber: version.versionNumber }),
    })

    return {
      file: { ...file, effectivePermission: access.level, sharedWithMe: Boolean(access.grant && access.grant.level !== 'owner') },
      version,
    }
  })

  res.json(payload)
})

filesRouter.get('/workspaces/:workspaceId/files/:fileId/versions', async (req, res) => {
  const userId = req.auth!.user.id
  const { workspaceId, fileId } = req.params
  const access = await requireResourcePermission(userId, workspaceId, 'file', fileId)

  if (!access.ok) {
    res.status(access.status).json({ error: access.error })
    return
  }

  const existingFile = await getVisibleFile(workspaceId, fileId)

  if (!existingFile) {
    res.status(404).json({ error: 'File not found' })
    return
  }

  const versions = await db
    .select(versionListFields())
    .from(fileVersions)
    .where(eq(fileVersions.fileId, fileId))
    .orderBy(desc(fileVersions.versionNumber))

  res.json({ versions })
})

filesRouter.get('/workspaces/:workspaceId/files/:fileId/download', async (req, res) => {
  const userId = req.auth!.user.id
  const { workspaceId, fileId } = req.params
  const access = await requireResourcePermission(userId, workspaceId, 'file', fileId)

  if (!access.ok) {
    res.status(access.status).json({ error: access.error })
    return
  }

  const existingFile = await getVisibleFile(workspaceId, fileId)

  if (!existingFile || existingFile.uploadStatus !== 'uploaded') {
    res.status(404).json({ error: 'File not found' })
    return
  }

  const [version] = await db
    .select(versionListFields())
    .from(fileVersions)
    .where(and(eq(fileVersions.fileId, fileId), eq(fileVersions.versionNumber, existingFile.latestVersionNumber)))
    .limit(1)

  if (!version || version.uploadStatus !== 'uploaded') {
    res.status(404).json({ error: 'Uploaded version not found' })
    return
  }

  const downloadUrl = await createDownloadUrl(version.objectKey, existingFile.name)

  res.json({ downloadUrl, expiresInSeconds: 600 })
})

filesRouter.get('/workspaces/:workspaceId/files/:fileId/versions/:versionId/download', async (req, res) => {
  const userId = req.auth!.user.id
  const { workspaceId, fileId, versionId } = req.params
  const access = await requireResourcePermission(userId, workspaceId, 'file', fileId)

  if (!access.ok) {
    res.status(access.status).json({ error: access.error })
    return
  }

  const existingFile = await getVisibleFile(workspaceId, fileId)

  if (!existingFile) {
    res.status(404).json({ error: 'File not found' })
    return
  }

  const [version] = await db
    .select(versionListFields())
    .from(fileVersions)
    .where(and(eq(fileVersions.fileId, fileId), eq(fileVersions.id, versionId)))
    .limit(1)

  if (!version || version.uploadStatus !== 'uploaded') {
    res.status(404).json({ error: 'Uploaded version not found' })
    return
  }

  const downloadUrl = await createDownloadUrl(version.objectKey, existingFile.name)

  res.json({ downloadUrl, expiresInSeconds: 600 })
})

filesRouter.patch('/workspaces/:workspaceId/files/:fileId', async (req, res) => {
  const userId = req.auth!.user.id
  const { workspaceId, fileId } = req.params
  const workspaceAccess = await requireWorkspaceRole(userId, workspaceId)

  if (!workspaceAccess.ok) {
    res.status(workspaceAccess.status).json({ error: workspaceAccess.error })
    return
  }

  const existingFile = await getVisibleFile(workspaceId, fileId)

  if (!existingFile) {
    res.status(404).json({ error: 'File not found' })
    return
  }

  const access = await requireResourcePermission(userId, workspaceId, 'file', fileId, 'edit')

  if (!access.ok) {
    res.status(access.status).json({ error: access.error })
    return
  }

  const name = req.body?.name === undefined ? existingFile.name : normalizeName(req.body.name)
  const folderId = req.body?.folderId === undefined ? existingFile.folderId : normalizeFolderId(req.body.folderId)

  if (name.length < 1 || name.length > 180) {
    res.status(400).json({ error: 'File name must be between 1 and 180 characters.' })
    return
  }

  if (!(await ensureFolderTarget(workspaceId, folderId))) {
    res.status(404).json({ error: 'Folder not found' })
    return
  }

  if (workspaceAccess.membership.role === 'viewer' && folderId !== existingFile.folderId) {
    res.status(403).json({ error: 'Only workspace members can move shared files between folders.' })
    return
  }

  try {
    const file = await db.transaction(async (tx) => {
      const [updatedFile] = await tx
        .update(files)
        .set({ name, folderId, updatedByUserId: userId, updatedAt: new Date() })
        .where(and(eq(files.workspaceId, workspaceId), eq(files.id, fileId), isNull(files.archivedAt)))
        .returning()

      await tx.insert(auditEvents).values({
        actorUserId: userId,
        action: 'file.updated',
        workspaceId,
        metadata: JSON.stringify({ fileId, name, folderId }),
      })

      return updatedFile
    })

    res.json({ file: { ...file, effectivePermission: access.level, sharedWithMe: Boolean(access.grant && access.grant.level !== 'owner') } })
  } catch (error) {
    if (sendConstraintError(res, error)) {
      return
    }

    throw error
  }
})

filesRouter.delete('/workspaces/:workspaceId/files/:fileId', async (req, res) => {
  const userId = req.auth!.user.id
  const { workspaceId, fileId } = req.params
  const workspaceAccess = await requireWorkspaceRole(userId, workspaceId)

  if (!workspaceAccess.ok) {
    res.status(workspaceAccess.status).json({ error: workspaceAccess.error })
    return
  }

  const existingFile = await getVisibleFile(workspaceId, fileId)

  if (!existingFile) {
    res.status(404).json({ error: 'File not found' })
    return
  }

  const access = await requireResourcePermission(userId, workspaceId, 'file', fileId, 'owner')

  if (!access.ok) {
    res.status(access.status).json({ error: access.error })
    return
  }

  const [file] = await db.transaction(async (tx) => {
    const [archivedFile] = await tx
      .update(files)
      .set({ archivedAt: new Date(), updatedByUserId: userId, updatedAt: new Date() })
      .where(and(eq(files.workspaceId, workspaceId), eq(files.id, fileId), isNull(files.archivedAt)))
      .returning()

    await tx.insert(auditEvents).values({
      actorUserId: userId,
      action: 'file.archived',
      workspaceId,
      metadata: JSON.stringify({ fileId }),
    })

    return [archivedFile]
  })

  res.json({ file: { ...file, effectivePermission: access.level, sharedWithMe: Boolean(access.grant && access.grant.level !== 'owner') } })
})
