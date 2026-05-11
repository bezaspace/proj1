import { Router } from 'express'
import { and, desc, eq, ilike, inArray, isNull, sql } from 'drizzle-orm'
import { db } from '../db/index.js'
import { chatMessages, documents, files, resourcePermissions, searchQueries } from '../db/schema.js'
import { rateLimit } from '../lib/rate-limit.js'
import { getEffectiveResourcePermission, requireWorkspaceRole } from '../lib/workspace-access.js'
import { requireAuth } from '../middleware/auth.js'

export const searchRouter = Router()

searchRouter.use(requireAuth)

type SearchType = 'all' | 'documents' | 'files' | 'chat'

function normalizeQuery(value: unknown) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, 120) : ''
}

function normalizeType(value: unknown): SearchType {
  return value === 'documents' || value === 'files' || value === 'chat' ? value : 'all'
}

function normalizeLimit(value: unknown) {
  const limit = Number(value)
  return Number.isInteger(limit) && limit > 0 ? Math.min(limit, 25) : 10
}

async function visibleResourceIds(userId: string, workspaceId: string, resourceType: 'document' | 'file') {
  const rows = await db
    .select({ resourceId: resourcePermissions.resourceId })
    .from(resourcePermissions)
    .where(
      and(
        eq(resourcePermissions.workspaceId, workspaceId),
        eq(resourcePermissions.resourceType, resourceType),
        eq(resourcePermissions.userId, userId),
      ),
    )

  return rows.map((row) => row.resourceId)
}

searchRouter.get(
  '/workspaces/:workspaceId/search',
  rateLimit({ keyPrefix: 'workspace_search', limit: 120, windowSeconds: 60 }),
  async (req, res) => {
    const userId = req.auth!.user.id
    const { workspaceId } = req.params
    const query = normalizeQuery(req.query.q)
    const type = normalizeType(req.query.type)
    const limit = normalizeLimit(req.query.limit)
    const access = await requireWorkspaceRole(userId, workspaceId)

    if (!access.ok) {
      res.status(access.status).json({ error: access.error })
      return
    }

    if (query.length < 2) {
      res.json({ query, results: [] })
      return
    }

    const pattern = `%${query.replaceAll('%', '\\%').replaceAll('_', '\\_')}%`
    const results: Array<Record<string, unknown>> = []

    if (type === 'all' || type === 'documents') {
      const documentIds =
        access.membership.role === 'viewer' ? await visibleResourceIds(userId, workspaceId, 'document') : null

      if (!documentIds || documentIds.length > 0) {
        const rows = await db
          .select({
            id: documents.id,
            title: documents.title,
            content: documents.content,
            updatedAt: documents.updatedAt,
          })
          .from(documents)
          .where(
            and(
              eq(documents.workspaceId, workspaceId),
              isNull(documents.archivedAt),
              documentIds ? inArray(documents.id, documentIds) : sql`true`,
              sql`to_tsvector('simple', ${documents.title} || ' ' || ${documents.content}) @@ plainto_tsquery('simple', ${query})
                or ${documents.title} ilike ${pattern}
                or ${documents.content} ilike ${pattern}`,
            ),
          )
          .orderBy(desc(documents.updatedAt))
          .limit(limit)

        for (const row of rows) {
          const permission = await getEffectiveResourcePermission(userId, workspaceId, 'document', row.id)

          if (permission) {
            results.push({
              type: 'document',
              id: row.id,
              title: row.title,
              excerpt: row.content.slice(0, 180),
              updatedAt: row.updatedAt,
            })
          }
        }
      }
    }

    if (type === 'all' || type === 'files') {
      const fileIds = access.membership.role === 'viewer' ? await visibleResourceIds(userId, workspaceId, 'file') : null

      if (!fileIds || fileIds.length > 0) {
        const rows = await db
          .select({
            id: files.id,
            name: files.name,
            mimeType: files.mimeType,
            sizeBytes: files.sizeBytes,
            updatedAt: files.updatedAt,
          })
          .from(files)
          .where(
            and(
              eq(files.workspaceId, workspaceId),
              isNull(files.archivedAt),
              fileIds ? inArray(files.id, fileIds) : sql`true`,
              ilike(files.name, pattern),
            ),
          )
          .orderBy(desc(files.updatedAt))
          .limit(limit)

        for (const row of rows) {
          const permission = await getEffectiveResourcePermission(userId, workspaceId, 'file', row.id)

          if (permission) {
            results.push({
              type: 'file',
              id: row.id,
              title: row.name,
              mimeType: row.mimeType,
              sizeBytes: row.sizeBytes,
              updatedAt: row.updatedAt,
            })
          }
        }
      }
    }

    if (type === 'all' || type === 'chat') {
      const rows = await db
        .select({
          id: chatMessages.id,
          channelId: chatMessages.channelId,
          body: chatMessages.body,
          sequenceNumber: chatMessages.sequenceNumber,
          createdAt: chatMessages.createdAt,
        })
        .from(chatMessages)
        .where(and(eq(chatMessages.workspaceId, workspaceId), isNull(chatMessages.archivedAt), ilike(chatMessages.body, pattern)))
        .orderBy(desc(chatMessages.createdAt))
        .limit(limit)

      results.push(
        ...rows.map((row) => ({
          type: 'chat',
          id: row.id,
          title: `Message #${row.sequenceNumber}`,
          excerpt: row.body.slice(0, 180),
          channelId: row.channelId,
          createdAt: row.createdAt,
        })),
      )
    }

    const slicedResults = results.slice(0, limit)

    await db.insert(searchQueries).values({
      workspaceId,
      userId,
      query,
      normalizedQuery: query.toLowerCase(),
      resultCount: slicedResults.length,
    })

    res.json({ query, results: slicedResults })
  },
)

searchRouter.get('/workspaces/:workspaceId/autocomplete', async (req, res) => {
  const userId = req.auth!.user.id
  const { workspaceId } = req.params
  const query = normalizeQuery(req.query.q)
  const limit = normalizeLimit(req.query.limit)
  const access = await requireWorkspaceRole(userId, workspaceId)

  if (!access.ok) {
    res.status(access.status).json({ error: access.error })
    return
  }

  if (query.length < 1) {
    res.json({ suggestions: [] })
    return
  }

  const prefix = `${query.replaceAll('%', '\\%').replaceAll('_', '\\_')}%`
  const documentIds = access.membership.role === 'viewer' ? await visibleResourceIds(userId, workspaceId, 'document') : null
  const fileIds = access.membership.role === 'viewer' ? await visibleResourceIds(userId, workspaceId, 'file') : null
  const [documentRows, fileRows, popularRows] = await Promise.all([
    documentIds && documentIds.length === 0
      ? Promise.resolve([])
      : db
          .select({ value: documents.title, type: sql<string>`'document'` })
          .from(documents)
          .where(
            and(
              eq(documents.workspaceId, workspaceId),
              isNull(documents.archivedAt),
              documentIds ? inArray(documents.id, documentIds) : sql`true`,
              ilike(documents.title, prefix),
            ),
          )
          .orderBy(desc(documents.updatedAt))
          .limit(limit),
    fileIds && fileIds.length === 0
      ? Promise.resolve([])
      : db
          .select({ value: files.name, type: sql<string>`'file'` })
          .from(files)
          .where(
            and(
              eq(files.workspaceId, workspaceId),
              isNull(files.archivedAt),
              fileIds ? inArray(files.id, fileIds) : sql`true`,
              ilike(files.name, prefix),
            ),
          )
          .orderBy(desc(files.updatedAt))
          .limit(limit),
    db
      .select({ value: searchQueries.query, type: sql<string>`'query'`, count: sql<number>`count(*)::int` })
      .from(searchQueries)
      .where(and(eq(searchQueries.workspaceId, workspaceId), ilike(searchQueries.normalizedQuery, prefix.toLowerCase())))
      .groupBy(searchQueries.query)
      .orderBy(sql`count(*) desc`)
      .limit(limit),
  ])

  const seen = new Set<string>()
  const suggestions = [...popularRows, ...documentRows, ...fileRows]
    .filter((row) => {
      const key = `${row.type}:${row.value.toLowerCase()}`

      if (seen.has(key)) {
        return false
      }

      seen.add(key)
      return true
    })
    .slice(0, limit)

  res.json({ suggestions })
})
