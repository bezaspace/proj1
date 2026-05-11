import { randomUUID } from 'node:crypto'
import type { IncomingMessage, Server } from 'node:http'
import type { Duplex } from 'node:stream'
import { fromNodeHeaders } from 'better-auth/node'
import { and, eq, isNull, max } from 'drizzle-orm'
import WebSocket, { WebSocketServer } from 'ws'
import * as Y from 'yjs'
import { auth } from './lib/auth.js'
import { db } from './db/index.js'
import { auditEvents, documentVersions, documents, notifications, resourcePermissions } from './db/schema.js'
import { createNotification } from './lib/notifications.js'
import { redis, redisPublisher, redisSubscriber } from './lib/redis.js'
import { checkRateLimit } from './lib/rate-limit.js'
import { createChatMessage, getVisibleChannel, normalizeMessageBody } from './lib/chat.js'
import { appendActivity } from './lib/activity.js'
import { requireResourcePermission, requireWorkspaceRole, type ResourcePermissionLevel } from './lib/workspace-access.js'

type RealtimeUser = {
  id: string
  name: string
  email: string
}

type RealtimeSocket = WebSocket & {
  connectionId: string
  isAlive: boolean
  user: RealtimeUser
  rooms: Map<string, ResourcePermissionLevel>
  workspaces: Set<string>
}

type DocumentRoom = {
  key: string
  workspaceId: string
  documentId: string
  title: string
  ydoc: Y.Doc
  clients: Set<RealtimeSocket>
  saveTimer: NodeJS.Timeout | null
  lastEditorUserId: string | null
}

type ClientMessage =
  | { type: 'document.join'; workspaceId: string; documentId: string }
  | { type: 'document.leave'; workspaceId: string; documentId: string }
  | { type: 'document.update'; workspaceId: string; documentId: string; update: string }
  | { type: 'document.presence'; workspaceId: string; documentId: string }
  | { type: 'document.snapshot'; workspaceId: string; documentId: string; title: string }
  | { type: 'workspace.join'; workspaceId: string }
  | { type: 'workspace.leave'; workspaceId: string }
  | { type: 'chat.typing'; workspaceId: string; channelId: string; isTyping: boolean }
  | { type: 'chat.message.send'; workspaceId: string; channelId: string; clientMessageId: string; body: string }
  | { type: 'ping' }

const documentRooms = new Map<string, DocumentRoom>()
const userSockets = new Map<string, Set<RealtimeSocket>>()

function documentRoomKey(workspaceId: string, documentId: string) {
  return `document:${workspaceId}:${documentId}`
}

function documentUpdateChannel(workspaceId: string, documentId: string) {
  return `${documentRoomKey(workspaceId, documentId)}:updates`
}

function workspaceEventsChannel(workspaceId: string) {
  return `workspace:${workspaceId}:events`
}

function encodeUpdate(update: Uint8Array) {
  return Buffer.from(update).toString('base64')
}

function decodeUpdate(value: string) {
  return new Uint8Array(Buffer.from(value, 'base64'))
}

function send(socket: RealtimeSocket, payload: unknown) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload))
  }
}

function broadcast(room: DocumentRoom, payload: unknown) {
  for (const client of room.clients) {
    send(client, payload)
  }
}

function parseClientMessage(data: WebSocket.RawData): ClientMessage | null {
  try {
    const parsed = JSON.parse(data.toString()) as Partial<ClientMessage>
    return typeof parsed.type === 'string' ? (parsed as ClientMessage) : null
  } catch {
    return null
  }
}

function validId(value: unknown) {
  return typeof value === 'string' && value.length > 0 && value.length < 80
}

function collaborators(room: DocumentRoom) {
  const byUser = new Map<string, { userId: string; name: string; email: string; connectionCount: number }>()

  for (const client of room.clients) {
    const existing = byUser.get(client.user.id)

    if (existing) {
      existing.connectionCount += 1
    } else {
      byUser.set(client.user.id, {
        userId: client.user.id,
        name: client.user.name,
        email: client.user.email,
        connectionCount: 1,
      })
    }
  }

  return Array.from(byUser.values()).sort((left, right) => left.email.localeCompare(right.email))
}

async function allowRealtimePatch(userId: string, documentId: string) {
  const result = await checkRateLimit(`${userId}:${documentId}`, {
    keyPrefix: 'document_patch',
    limit: 40,
    windowSeconds: 1,
  })

  return result.allowed
}

async function allowChatSend(userId: string, channelId: string) {
  const result = await checkRateLimit(`${userId}:${channelId}`, {
    keyPrefix: 'chat_send',
    limit: 60,
    windowSeconds: 60,
  })

  return result.allowed
}

function broadcastWorkspace(workspaceId: string, payload: unknown) {
  for (const sockets of userSockets.values()) {
    for (const socket of sockets) {
      if (socket.workspaces.has(workspaceId)) {
        send(socket, payload)
      }
    }
  }
}

async function workspacePresence(workspaceId: string) {
  const keys = await redis.keys(`presence:workspace:${workspaceId}:*`)
  if (!keys.length) {
    return []
  }

  const values = await redis.mGet(keys)
  const byUser = new Map<string, { userId: string; name: string; email: string; connectionCount: number }>()

  for (const value of values) {
    if (!value) {
      continue
    }

    const parsed = JSON.parse(value) as { userId: string; name: string; email: string }
    const existing = byUser.get(parsed.userId)

    if (existing) {
      existing.connectionCount += 1
    } else {
      byUser.set(parsed.userId, { ...parsed, connectionCount: 1 })
    }
  }

  return Array.from(byUser.values()).sort((left, right) => left.email.localeCompare(right.email))
}

async function publishWorkspacePresence(workspaceId: string) {
  await redisPublisher.publish(
    workspaceEventsChannel(workspaceId),
    JSON.stringify({ type: 'workspace.presence', workspaceId, members: await workspacePresence(workspaceId) }),
  )
}

async function joinWorkspace(socket: RealtimeSocket, workspaceId: string) {
  if (!validId(workspaceId)) {
    send(socket, { type: 'error', error: 'Invalid workspace.' })
    return
  }

  const access = await requireWorkspaceRole(socket.user.id, workspaceId)
  if (!access.ok) {
    send(socket, { type: 'error', error: access.error })
    return
  }

  socket.workspaces.add(workspaceId)
  await redis.setEx(
    `presence:workspace:${workspaceId}:${socket.user.id}:${socket.connectionId}`,
    45,
    JSON.stringify({ userId: socket.user.id, name: socket.user.name, email: socket.user.email }),
  )

  send(socket, { type: 'workspace.presence', workspaceId, members: await workspacePresence(workspaceId) })
  await publishWorkspacePresence(workspaceId)
}

async function leaveWorkspace(socket: RealtimeSocket, workspaceId: string) {
  socket.workspaces.delete(workspaceId)
  await redis.del(`presence:workspace:${workspaceId}:${socket.user.id}:${socket.connectionId}`)
  await publishWorkspacePresence(workspaceId)
}

async function refreshWorkspacePresence(socket: RealtimeSocket) {
  for (const workspaceId of socket.workspaces) {
    await redis.setEx(
      `presence:workspace:${workspaceId}:${socket.user.id}:${socket.connectionId}`,
      45,
      JSON.stringify({ userId: socket.user.id, name: socket.user.name, email: socket.user.email }),
    )
  }
}

async function loadDocumentRoom(workspaceId: string, documentId: string) {
  const key = documentRoomKey(workspaceId, documentId)
  const cached = documentRooms.get(key)

  if (cached) {
    return cached
  }

  const [document] = await db
    .select({
      id: documents.id,
      workspaceId: documents.workspaceId,
      title: documents.title,
      content: documents.content,
      crdtState: documents.crdtState,
    })
    .from(documents)
    .where(and(eq(documents.workspaceId, workspaceId), eq(documents.id, documentId), isNull(documents.archivedAt)))
    .limit(1)

  if (!document) {
    return null
  }

  const ydoc = new Y.Doc()
  const ytext = ydoc.getText('content')

  if (document.crdtState) {
    Y.applyUpdate(ydoc, decodeUpdate(document.crdtState), { source: 'database' })
  } else if (document.content) {
    ytext.insert(0, document.content)
  }

  const room: DocumentRoom = {
    key,
    workspaceId,
    documentId,
    title: document.title,
    ydoc,
    clients: new Set(),
    saveTimer: null,
    lastEditorUserId: null,
  }

  ydoc.on('update', (update, origin) => {
    const encodedUpdate = encodeUpdate(update)
    const userId = typeof origin === 'object' && origin && 'userId' in origin ? String(origin.userId) : null

    broadcast(room, {
      type: 'document.update',
      workspaceId,
      documentId,
      update: encodedUpdate,
      userId,
    })

    if (!(typeof origin === 'object' && origin && 'source' in origin && origin.source === 'redis')) {
      void redisPublisher.publish(
        documentUpdateChannel(workspaceId, documentId),
        JSON.stringify({ update: encodedUpdate, userId }),
      )
    }

    room.lastEditorUserId = userId
    scheduleDocumentStatePersist(room)
  })

  documentRooms.set(key, room)
  return room
}

function scheduleDocumentStatePersist(room: DocumentRoom) {
  if (room.saveTimer) {
    clearTimeout(room.saveTimer)
  }

  room.saveTimer = setTimeout(() => {
    void persistDocumentState(room, room.lastEditorUserId, false)
  }, 2500)
}

async function persistDocumentState(room: DocumentRoom, editorUserId: string | null, createVersion: boolean) {
  const content = room.ydoc.getText('content').toString()
  const crdtState = encodeUpdate(Y.encodeStateAsUpdate(room.ydoc))
  const updatedAt = new Date()

  const result = await db.transaction(async (tx) => {
    const [document] = await tx
      .update(documents)
      .set({
        title: room.title,
        content,
        crdtState,
        updatedByUserId: editorUserId ?? 'system',
        updatedAt,
      })
      .where(and(eq(documents.workspaceId, room.workspaceId), eq(documents.id, room.documentId), isNull(documents.archivedAt)))
      .returning()

    if (!document) {
      return { document: null, versionNumber: null, notifications: [] as Array<typeof notifications.$inferSelect> }
    }

    if (!createVersion || !editorUserId) {
      return { document, versionNumber: null, notifications: [] as Array<typeof notifications.$inferSelect> }
    }

    const [versionRow] = await tx
      .select({ value: max(documentVersions.versionNumber) })
      .from(documentVersions)
      .where(eq(documentVersions.documentId, room.documentId))

    const versionNumber = Number(versionRow?.value ?? 0) + 1

    await tx.insert(documentVersions).values({
      documentId: room.documentId,
      versionNumber,
      title: document.title,
      content: document.content,
      editorUserId,
    })

    await tx.insert(auditEvents).values({
      actorUserId: editorUserId,
      action: 'document.realtime_snapshot_saved',
      workspaceId: room.workspaceId,
      metadata: JSON.stringify({ documentId: room.documentId, versionNumber }),
    })

    const grants = await tx
      .select({ userId: resourcePermissions.userId })
      .from(resourcePermissions)
      .where(
        and(
          eq(resourcePermissions.workspaceId, room.workspaceId),
          eq(resourcePermissions.resourceType, 'document'),
          eq(resourcePermissions.resourceId, room.documentId),
        ),
      )

    const recipientIds = [...new Set(grants.map((grant) => grant.userId).filter((userId) => userId !== editorUserId))]
    const savedNotifications: Array<typeof notifications.$inferSelect> = []

    for (const recipientUserId of recipientIds) {
      const notification = await createNotification(tx, {
        recipientUserId,
        actorUserId: editorUserId,
        workspaceId: room.workspaceId,
        type: 'document_updated',
        entityType: 'document',
        entityId: room.documentId,
        title: 'Document updated',
        body: `A shared document was updated: ${document.title}`,
        metadata: { documentId: room.documentId, title: document.title, versionNumber },
        dedupeKey: `document_updated:${room.documentId}:${recipientUserId}:${versionNumber}`,
      })

      if (notification) {
        savedNotifications.push(notification)
      }
    }

    await appendActivity(tx, {
      workspaceId: room.workspaceId,
      actorUserId: editorUserId,
      eventType: 'document.realtime_snapshot_saved',
      entityType: 'document',
      entityId: room.documentId,
      summary: `Document "${document.title}" was saved from realtime editing`,
      metadata: { documentId: room.documentId, versionNumber },
    })

    return { document, versionNumber, notifications: savedNotifications }
  })

  return result
}

async function joinDocument(socket: RealtimeSocket, workspaceId: string, documentId: string) {
  if (!validId(workspaceId) || !validId(documentId)) {
    send(socket, { type: 'error', error: 'Invalid document room.' })
    return
  }

  const access = await requireResourcePermission(socket.user.id, workspaceId, 'document', documentId, 'view')

  if (!access.ok) {
    send(socket, { type: 'error', error: access.error })
    return
  }

  const room = await loadDocumentRoom(workspaceId, documentId)

  if (!room) {
    send(socket, { type: 'error', error: 'Document not found' })
    return
  }

  room.clients.add(socket)
  socket.rooms.set(room.key, access.level)

  await redis.setEx(
    `presence:${room.key}:${socket.user.id}:${socket.connectionId}`,
    45,
    JSON.stringify({ userId: socket.user.id, name: socket.user.name, email: socket.user.email }),
  )

  send(socket, {
    type: 'document.state',
    workspaceId,
    documentId,
    title: room.title,
    update: encodeUpdate(Y.encodeStateAsUpdate(room.ydoc)),
    effectivePermission: access.level,
    collaborators: collaborators(room),
  })

  broadcast(room, { type: 'document.presence', workspaceId, documentId, collaborators: collaborators(room) })
}

async function leaveDocument(socket: RealtimeSocket, workspaceId: string, documentId: string) {
  const key = documentRoomKey(workspaceId, documentId)
  const room = documentRooms.get(key)

  if (!room) {
    return
  }

  room.clients.delete(socket)
  socket.rooms.delete(key)
  await redis.del(`presence:${room.key}:${socket.user.id}:${socket.connectionId}`)
  broadcast(room, { type: 'document.presence', workspaceId, documentId, collaborators: collaborators(room) })
}

async function handleDocumentUpdate(socket: RealtimeSocket, message: Extract<ClientMessage, { type: 'document.update' }>) {
  const key = documentRoomKey(message.workspaceId, message.documentId)
  const room = documentRooms.get(key)

  if (!room || !socket.rooms.has(key)) {
    send(socket, { type: 'error', error: 'Join the document before sending updates.' })
    return
  }

  if (!(await allowRealtimePatch(socket.user.id, message.documentId))) {
    send(socket, { type: 'error', error: 'Realtime edit rate limit exceeded. Slow down and retry shortly.' })
    return
  }

  const access = await requireResourcePermission(socket.user.id, message.workspaceId, 'document', message.documentId, 'edit')

  if (!access.ok) {
    send(socket, { type: 'error', error: access.error })
    return
  }

  Y.applyUpdate(room.ydoc, decodeUpdate(message.update), { source: 'client', userId: socket.user.id })
}

async function handleDocumentSnapshot(socket: RealtimeSocket, message: Extract<ClientMessage, { type: 'document.snapshot' }>) {
  const key = documentRoomKey(message.workspaceId, message.documentId)
  const room = documentRooms.get(key)

  if (!room || !socket.rooms.has(key)) {
    send(socket, { type: 'error', error: 'Join the document before saving a snapshot.' })
    return
  }

  const title = typeof message.title === 'string' ? message.title.trim() : ''

  if (title.length < 1 || title.length > 120) {
    send(socket, { type: 'error', error: 'Document title must be between 1 and 120 characters.' })
    return
  }

  const access = await requireResourcePermission(socket.user.id, message.workspaceId, 'document', message.documentId, 'edit')

  if (!access.ok) {
    send(socket, { type: 'error', error: access.error })
    return
  }

  room.title = title
  const result = await persistDocumentState(room, socket.user.id, true)

  if (!result.document) {
    send(socket, { type: 'error', error: 'Document not found' })
    return
  }

  broadcast(room, {
    type: 'document.snapshot.saved',
    workspaceId: message.workspaceId,
    documentId: message.documentId,
    title,
    versionNumber: result.versionNumber,
    document: {
      ...result.document,
      effectivePermission: access.level,
      sharedWithMe: Boolean(access.grant && access.grant.level !== 'owner'),
    },
  })
}

function trackSocket(socket: RealtimeSocket) {
  const sockets = userSockets.get(socket.user.id) ?? new Set<RealtimeSocket>()
  sockets.add(socket)
  userSockets.set(socket.user.id, sockets)
}

function untrackSocket(socket: RealtimeSocket) {
  const sockets = userSockets.get(socket.user.id)

  if (!sockets) {
    return
  }

  sockets.delete(socket)

  if (!sockets.size) {
    userSockets.delete(socket.user.id)
  }
}

async function closeSocket(socket: RealtimeSocket) {
  const joinedRooms = Array.from(socket.rooms.keys())
  const joinedWorkspaces = Array.from(socket.workspaces)

  for (const key of joinedRooms) {
    const room = documentRooms.get(key)

    if (room) {
      await leaveDocument(socket, room.workspaceId, room.documentId)
    }
  }

  for (const workspaceId of joinedWorkspaces) {
    await leaveWorkspace(socket, workspaceId)
  }

  untrackSocket(socket)
}

async function handleChatTyping(socket: RealtimeSocket, message: Extract<ClientMessage, { type: 'chat.typing' }>) {
  if (!socket.workspaces.has(message.workspaceId)) {
    send(socket, { type: 'error', error: 'Join the workspace before sending typing events.' })
    return
  }

  const channel = await getVisibleChannel(message.workspaceId, message.channelId)
  if (!channel) {
    send(socket, { type: 'error', error: 'Channel not found' })
    return
  }

  await redisPublisher.publish(
    workspaceEventsChannel(message.workspaceId),
    JSON.stringify({
      type: 'chat.typing',
      workspaceId: message.workspaceId,
      channelId: message.channelId,
      userId: socket.user.id,
      name: socket.user.name,
      email: socket.user.email,
      isTyping: Boolean(message.isTyping),
    }),
  )
}

async function handleChatMessage(socket: RealtimeSocket, message: Extract<ClientMessage, { type: 'chat.message.send' }>) {
  if (!socket.workspaces.has(message.workspaceId)) {
    send(socket, { type: 'error', error: 'Join the workspace before sending messages.' })
    return
  }

  if (!(await allowChatSend(socket.user.id, message.channelId))) {
    send(socket, { type: 'error', error: 'Chat send rate limit exceeded. Slow down and retry shortly.' })
    return
  }

  const body = normalizeMessageBody(message.body)
  const clientMessageId = typeof message.clientMessageId === 'string' ? message.clientMessageId.trim() : ''

  if (body.length < 1 || body.length > 4000) {
    send(socket, { type: 'error', error: 'Message must be between 1 and 4000 characters.' })
    return
  }

  if (clientMessageId.length < 8 || clientMessageId.length > 120) {
    send(socket, { type: 'error', error: 'Message idempotency key is invalid.' })
    return
  }

  const channel = await getVisibleChannel(message.workspaceId, message.channelId)
  if (!channel) {
    send(socket, { type: 'error', error: 'Channel not found' })
    return
  }

  const created = await createChatMessage({
    workspaceId: message.workspaceId,
    channelId: message.channelId,
    senderUserId: socket.user.id,
    clientMessageId,
    body,
  })

  if (!created) {
    send(socket, { type: 'error', error: 'Could not save chat message.' })
    return
  }

  send(socket, {
    type: 'chat.message.ack',
    workspaceId: message.workspaceId,
    channelId: message.channelId,
    clientMessageId,
    message: created.message,
    duplicate: !created.created,
  })

  if (created.created) {
    await redisPublisher.publish(
      workspaceEventsChannel(message.workspaceId),
      JSON.stringify({
        type: 'chat.message.created',
        workspaceId: message.workspaceId,
        channelId: message.channelId,
        message: created.message,
      }),
    )
  }
}

async function handleSocketMessage(socket: RealtimeSocket, message: ClientMessage | null) {
  if (!message) {
    send(socket, { type: 'error', error: 'Malformed realtime message.' })
    return
  }

  if (message.type === 'ping') {
    await refreshWorkspacePresence(socket)
    send(socket, { type: 'pong' })
    return
  }

  if (message.type === 'workspace.join') {
    await joinWorkspace(socket, message.workspaceId)
    return
  }

  if (message.type === 'workspace.leave') {
    await leaveWorkspace(socket, message.workspaceId)
    return
  }

  if (message.type === 'document.join') {
    await joinDocument(socket, message.workspaceId, message.documentId)
    return
  }

  if (message.type === 'document.leave') {
    await leaveDocument(socket, message.workspaceId, message.documentId)
    return
  }

  if (message.type === 'document.update') {
    await handleDocumentUpdate(socket, message)
    return
  }

  if (message.type === 'document.presence') {
    const room = documentRooms.get(documentRoomKey(message.workspaceId, message.documentId))

    if (room) {
      broadcast(room, {
        type: 'document.presence',
        workspaceId: message.workspaceId,
        documentId: message.documentId,
        collaborators: collaborators(room),
      })
    }
    return
  }

  if (message.type === 'document.snapshot') {
    await handleDocumentSnapshot(socket, message)
    return
  }

  if (message.type === 'chat.typing') {
    await handleChatTyping(socket, message)
    return
  }

  if (message.type === 'chat.message.send') {
    await handleChatMessage(socket, message)
  }
}

async function authenticateUpgrade(request: IncomingMessage) {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) })

  if (!session) {
    return null
  }

  return {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
  }
}

function rejectUpgrade(socket: Duplex, statusCode: number, message: string) {
  socket.write(`HTTP/1.1 ${statusCode} ${message}\r\n\r\n`)
  socket.destroy()
}

export async function setupRealtimeServer(server: Server) {
  const wss = new WebSocketServer({ noServer: true })

  await redisSubscriber.pSubscribe('document:*:updates', (message, channel) => {
    const [, workspaceId, documentId] = channel.split(':')
    const room = documentRooms.get(documentRoomKey(workspaceId, documentId))

    if (!room) {
      return
    }

    const parsed = JSON.parse(message) as { update: string; userId: string | null }
    Y.applyUpdate(room.ydoc, decodeUpdate(parsed.update), { source: 'redis', userId: parsed.userId })
  })

  await redisSubscriber.pSubscribe('user:*:notifications', (message) => {
    const parsed = JSON.parse(message) as { type: 'notification.created'; notification: typeof notifications.$inferSelect; unreadCount: number }
    const sockets = userSockets.get(parsed.notification.recipientUserId)

    if (!sockets) {
      return
    }

    for (const socket of sockets) {
      send(socket, parsed)
    }
  })

  await redisSubscriber.pSubscribe('workspace:*:events', (message, channel) => {
    const [, workspaceId] = channel.split(':')
    broadcastWorkspace(workspaceId, JSON.parse(message))
  })

  server.on('upgrade', (request, socket, head) => {
    const pathname = request.url ? new URL(request.url, 'http://localhost').pathname : ''

    if (pathname !== '/api/realtime') {
      socket.destroy()
      return
    }

    socket.on('error', console.error)

    authenticateUpgrade(request)
      .then((user) => {
        if (!user) {
          rejectUpgrade(socket, 401, 'Unauthorized')
          return
        }

        socket.removeListener('error', console.error)
        wss.handleUpgrade(request, socket, head, (ws) => {
          wss.emit('connection', ws, request, user)
        })
      })
      .catch((error) => {
        console.error('Realtime auth failed', error)
        rejectUpgrade(socket, 500, 'Internal Server Error')
      })
  })

  wss.on('connection', (ws: WebSocket, _request: IncomingMessage, user: RealtimeUser) => {
    const socket = ws as RealtimeSocket
    socket.connectionId = randomUUID()
    socket.isAlive = true
    socket.user = user
    socket.rooms = new Map()
    socket.workspaces = new Set()
    trackSocket(socket)

    socket.on('pong', () => {
      socket.isAlive = true
    })

    socket.on('message', (data) => {
      void handleSocketMessage(socket, parseClientMessage(data)).catch((error) => {
        console.error('Realtime message failed', error)
        send(socket, { type: 'error', error: 'Realtime operation failed.' })
      })
    })

    socket.on('close', () => {
      void closeSocket(socket)
    })

    socket.on('error', console.error)
    send(socket, { type: 'ready' })
  })

  const interval = setInterval(() => {
    wss.clients.forEach((client) => {
      const socket = client as RealtimeSocket

      if (!socket.isAlive) {
        socket.terminate()
        return
      }

      socket.isAlive = false
      socket.ping()
    })
  }, 30000)

  wss.on('close', () => {
    clearInterval(interval)
  })
}
