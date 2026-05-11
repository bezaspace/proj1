import { and, desc, eq, isNull, lt, max, sql } from 'drizzle-orm'
import { db } from '../db/index.js'
import { chatChannels, chatMessages, users, workspaceMembers } from '../db/schema.js'
import { appendActivity } from './activity.js'
import { createNotification } from './notifications.js'

export function chatChannelFields() {
  return {
    id: chatChannels.id,
    workspaceId: chatChannels.workspaceId,
    name: chatChannels.name,
    createdByUserId: chatChannels.createdByUserId,
    archivedAt: chatChannels.archivedAt,
    createdAt: chatChannels.createdAt,
    updatedAt: chatChannels.updatedAt,
  }
}

export function chatMessageFields() {
  return {
    id: chatMessages.id,
    workspaceId: chatMessages.workspaceId,
    channelId: chatMessages.channelId,
    senderUserId: chatMessages.senderUserId,
    clientMessageId: chatMessages.clientMessageId,
    sequenceNumber: chatMessages.sequenceNumber,
    body: chatMessages.body,
    createdAt: chatMessages.createdAt,
    editedAt: chatMessages.editedAt,
    archivedAt: chatMessages.archivedAt,
    senderName: users.name,
    senderEmail: users.email,
  }
}

export type ChatMessageWithSender = ReturnType<typeof chatMessageFields>

export function normalizeChannelName(value: unknown) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, '-').toLowerCase() : ''
}

export function normalizeMessageBody(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

export async function ensureGeneralChannel(workspaceId: string, actorUserId: string) {
  const [existing] = await db
    .select(chatChannelFields())
    .from(chatChannels)
    .where(and(eq(chatChannels.workspaceId, workspaceId), eq(sql`lower(${chatChannels.name})`, 'general'), isNull(chatChannels.archivedAt)))
    .limit(1)

  if (existing) {
    return existing
  }

  const [created] = await db
    .insert(chatChannels)
    .values({
      workspaceId,
      name: 'general',
      createdByUserId: actorUserId,
    })
    .onConflictDoNothing()
    .returning()

  if (created) {
    return created
  }

  const [raceWinner] = await db
    .select(chatChannelFields())
    .from(chatChannels)
    .where(and(eq(chatChannels.workspaceId, workspaceId), eq(sql`lower(${chatChannels.name})`, 'general'), isNull(chatChannels.archivedAt)))
    .limit(1)

  return raceWinner
}

export async function getVisibleChannel(workspaceId: string, channelId: string) {
  const [channel] = await db
    .select(chatChannelFields())
    .from(chatChannels)
    .where(and(eq(chatChannels.workspaceId, workspaceId), eq(chatChannels.id, channelId), isNull(chatChannels.archivedAt)))
    .limit(1)

  return channel ?? null
}

async function serializeMessage(messageId: string) {
  const [message] = await db
    .select(chatMessageFields())
    .from(chatMessages)
    .innerJoin(users, eq(chatMessages.senderUserId, users.id))
    .where(eq(chatMessages.id, messageId))
    .limit(1)

  return message ?? null
}

async function findMentionRecipients(workspaceId: string, actorUserId: string, body: string) {
  const normalizedBody = body.toLowerCase()
  const members = await db
    .select({
      userId: workspaceMembers.userId,
      userName: users.name,
      userEmail: users.email,
    })
    .from(workspaceMembers)
    .innerJoin(users, eq(workspaceMembers.userId, users.id))
    .where(eq(workspaceMembers.workspaceId, workspaceId))

  return members.filter((member) => {
    if (member.userId === actorUserId) {
      return false
    }

    const email = member.userEmail.toLowerCase()
    const compactName = member.userName.toLowerCase().replace(/\s+/g, '')
    return normalizedBody.includes(`@${email}`) || normalizedBody.includes(`@${compactName}`)
  })
}

export async function createChatMessage(input: {
  workspaceId: string
  channelId: string
  senderUserId: string
  clientMessageId: string
  body: string
}) {
  const inserted = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.channelId}))`)

    const [existing] = await tx
      .select({ id: chatMessages.id })
      .from(chatMessages)
      .where(
        and(
          eq(chatMessages.channelId, input.channelId),
          eq(chatMessages.senderUserId, input.senderUserId),
          eq(chatMessages.clientMessageId, input.clientMessageId),
        ),
      )
      .limit(1)

    if (existing) {
      return { messageId: existing.id, created: false }
    }

    const [sequenceRow] = await tx
      .select({ value: max(chatMessages.sequenceNumber) })
      .from(chatMessages)
      .where(eq(chatMessages.channelId, input.channelId))

    const sequenceNumber = Number(sequenceRow?.value ?? 0) + 1
    const [message] = await tx
      .insert(chatMessages)
      .values({
        workspaceId: input.workspaceId,
        channelId: input.channelId,
        senderUserId: input.senderUserId,
        clientMessageId: input.clientMessageId,
        sequenceNumber,
        body: input.body,
      })
      .returning()

    await appendActivity(tx, {
      workspaceId: input.workspaceId,
      actorUserId: input.senderUserId,
      eventType: 'chat.message_sent',
      entityType: 'chat_message',
      entityId: message.id,
      summary: `Message sent in channel`,
      metadata: { channelId: input.channelId, sequenceNumber },
    })

    const recipients = await findMentionRecipients(input.workspaceId, input.senderUserId, input.body)
    for (const recipient of recipients) {
      await createNotification(tx, {
        recipientUserId: recipient.userId,
        actorUserId: input.senderUserId,
        workspaceId: input.workspaceId,
        type: 'chat_mention',
        entityType: 'chat_message',
        entityId: message.id,
        title: 'Chat mention',
        body: `You were mentioned in a workspace chat message.`,
        metadata: { channelId: input.channelId, messageId: message.id, sequenceNumber },
        dedupeKey: `chat_mention:${message.id}:${recipient.userId}`,
      })
    }

    return { messageId: message.id, created: true }
  })

  const message = await serializeMessage(inserted.messageId)
  return message ? { message, created: inserted.created } : null
}

export async function listChannelMessages(channelId: string, beforeSequence: number | null, limit: number) {
  const rows = await db
    .select(chatMessageFields())
    .from(chatMessages)
    .innerJoin(users, eq(chatMessages.senderUserId, users.id))
    .where(
      beforeSequence
        ? and(eq(chatMessages.channelId, channelId), lt(chatMessages.sequenceNumber, beforeSequence), isNull(chatMessages.archivedAt))
        : and(eq(chatMessages.channelId, channelId), isNull(chatMessages.archivedAt)),
    )
    .orderBy(desc(chatMessages.sequenceNumber))
    .limit(limit + 1)

  const hasMore = rows.length > limit
  const page = hasMore ? rows.slice(0, limit) : rows

  return {
    messages: page.reverse(),
    nextCursor: hasMore ? page[0]?.sequenceNumber ?? null : null,
  }
}
