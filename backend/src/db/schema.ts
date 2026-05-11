import { relations, sql } from 'drizzle-orm'
import { boolean, index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

export const workspaceRole = pgEnum('workspace_role', ['owner', 'admin', 'member', 'viewer'])
export const fileUploadStatus = pgEnum('file_upload_status', ['pending', 'uploaded', 'failed'])
export const workspaceInviteStatus = pgEnum('workspace_invite_status', ['pending', 'accepted', 'revoked', 'expired'])
export const resourceType = pgEnum('resource_type', ['document', 'file'])
export const resourcePermissionLevel = pgEnum('resource_permission_level', ['view', 'edit', 'owner'])
export const notificationType = pgEnum('notification_type', [
  'workspace_invite',
  'document_shared',
  'file_shared',
  'document_updated',
  'chat_mention',
])
export const outboxEventStatus = pgEnum('outbox_event_status', ['pending', 'processed', 'failed'])
export const backgroundJobStatus = pgEnum('background_job_status', ['queued', 'running', 'succeeded', 'failed', 'dead'])
export const notificationDeliveryStatus = pgEnum('notification_delivery_status', [
  'pending',
  'delivered',
  'failed',
  'skipped',
])
export const uploadSessionStatus = pgEnum('upload_session_status', ['pending', 'completed', 'failed', 'expired'])

export const users = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull(),
})

export const workspaces = pgTable('workspaces', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  createdByUserId: text('created_by_user_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const workspaceMembers = pgTable(
  'workspace_members',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    role: workspaceRole('role').notNull().default('member'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    workspaceUserIdx: uniqueIndex('workspace_members_workspace_user_idx').on(table.workspaceId, table.userId),
    userIdx: index('workspace_members_user_idx').on(table.userId),
  }),
)

export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    actorUserId: text('actor_user_id').notNull(),
    action: text('action').notNull(),
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'set null' }),
    metadata: text('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    workspaceIdx: index('audit_events_workspace_idx').on(table.workspaceId),
    actorIdx: index('audit_events_actor_idx').on(table.actorUserId),
  }),
)

export const workspaceInvites = pgTable(
  'workspace_invites',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: workspaceRole('role').notNull().default('viewer'),
    status: workspaceInviteStatus('status').notNull().default('pending'),
    invitedByUserId: text('invited_by_user_id').notNull(),
    acceptedByUserId: text('accepted_by_user_id'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    workspaceStatusIdx: index('workspace_invites_workspace_status_idx').on(table.workspaceId, table.status),
    emailStatusIdx: index('workspace_invites_email_status_idx').on(table.email, table.status),
    pendingEmailIdx: uniqueIndex('workspace_invites_pending_email_idx')
      .on(table.workspaceId, sql`lower(${table.email})`)
      .where(sql`${table.status} = 'pending'`),
  }),
)

export const resourcePermissions = pgTable(
  'resource_permissions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    resourceType: resourceType('resource_type').notNull(),
    resourceId: uuid('resource_id').notNull(),
    userId: text('user_id').notNull(),
    level: resourcePermissionLevel('level').notNull(),
    grantedByUserId: text('granted_by_user_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    resourceUserIdx: uniqueIndex('resource_permissions_resource_user_idx').on(
      table.workspaceId,
      table.resourceType,
      table.resourceId,
      table.userId,
    ),
    userIdx: index('resource_permissions_user_idx').on(table.userId),
    resourceIdx: index('resource_permissions_resource_idx').on(table.workspaceId, table.resourceType, table.resourceId),
  }),
)

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    recipientUserId: text('recipient_user_id').notNull(),
    actorUserId: text('actor_user_id').notNull(),
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    type: notificationType('type').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    metadata: text('metadata'),
    dedupeKey: text('dedupe_key').notNull(),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    recipientCreatedIdx: index('notifications_recipient_created_idx').on(table.recipientUserId, table.createdAt),
    unreadIdx: index('notifications_unread_idx').on(table.recipientUserId, table.readAt),
    dedupeIdx: uniqueIndex('notifications_dedupe_idx').on(table.dedupeKey),
  }),
)

export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    eventType: text('event_type').notNull(),
    aggregateType: text('aggregate_type').notNull(),
    aggregateId: text('aggregate_id').notNull(),
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    actorUserId: text('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    payload: text('payload').notNull().default('{}'),
    idempotencyKey: text('idempotency_key').notNull(),
    status: outboxEventStatus('status').notNull().default('pending'),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    idempotencyIdx: uniqueIndex('outbox_events_idempotency_idx').on(table.idempotencyKey),
    statusCreatedIdx: index('outbox_events_status_created_idx').on(table.status, table.createdAt),
    workspaceCreatedIdx: index('outbox_events_workspace_created_idx').on(table.workspaceId, table.createdAt),
  }),
)

export const backgroundJobs = pgTable(
  'background_jobs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    outboxEventId: uuid('outbox_event_id').references(() => outboxEvents.id, { onDelete: 'set null' }),
    jobType: text('job_type').notNull(),
    payload: text('payload').notNull().default('{}'),
    status: backgroundJobStatus('status').notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    runAfter: timestamp('run_after', { withTimezone: true }).defaultNow().notNull(),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    lockedBy: text('locked_by'),
    lastError: text('last_error'),
    idempotencyKey: text('idempotency_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    idempotencyIdx: uniqueIndex('background_jobs_idempotency_idx').on(table.idempotencyKey),
    statusRunAfterIdx: index('background_jobs_status_run_after_idx').on(table.status, table.runAfter),
    outboxEventIdx: index('background_jobs_outbox_event_idx').on(table.outboxEventId),
  }),
)

export const jobAttempts = pgTable(
  'job_attempts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => backgroundJobs.id, { onDelete: 'cascade' }),
    attemptNumber: integer('attempt_number').notNull(),
    status: backgroundJobStatus('status').notNull(),
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (table) => ({
    jobIdx: index('job_attempts_job_idx').on(table.jobId, table.attemptNumber),
  }),
)

export const activityEvents = pgTable(
  'activity_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    actorUserId: text('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    eventType: text('event_type').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    summary: text('summary').notNull(),
    metadata: text('metadata').notNull().default('{}'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    workspaceCreatedIdx: index('activity_events_workspace_created_idx').on(table.workspaceId, table.createdAt, table.id),
    entityIdx: index('activity_events_entity_idx').on(table.workspaceId, table.entityType, table.entityId),
  }),
)

export const chatChannels = pgTable(
  'chat_channels',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    createdByUserId: text('created_by_user_id').notNull(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    workspaceNameIdx: uniqueIndex('chat_channels_workspace_name_active_idx')
      .on(table.workspaceId, sql`lower(${table.name})`)
      .where(sql`${table.archivedAt} is null`),
    workspaceUpdatedIdx: index('chat_channels_workspace_updated_idx').on(table.workspaceId, table.updatedAt),
  }),
)

export const chatMessages = pgTable(
  'chat_messages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    channelId: uuid('channel_id')
      .notNull()
      .references(() => chatChannels.id, { onDelete: 'cascade' }),
    senderUserId: text('sender_user_id').notNull(),
    clientMessageId: text('client_message_id').notNull(),
    sequenceNumber: integer('sequence_number').notNull(),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (table) => ({
    channelSequenceIdx: uniqueIndex('chat_messages_channel_sequence_idx').on(table.channelId, table.sequenceNumber),
    clientIdIdx: uniqueIndex('chat_messages_client_id_idx').on(
      table.channelId,
      table.senderUserId,
      table.clientMessageId,
    ),
    workspaceCreatedIdx: index('chat_messages_workspace_created_idx').on(table.workspaceId, table.createdAt),
    channelSequenceDescIdx: index('chat_messages_channel_sequence_desc_idx').on(table.channelId, table.sequenceNumber),
  }),
)

export const notificationPreferences = pgTable('notification_preferences', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  inAppEnabled: boolean('in_app_enabled').notNull().default(true),
  realtimeEnabled: boolean('realtime_enabled').notNull().default(true),
  emailEnabled: boolean('email_enabled').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const notificationDeliveries = pgTable(
  'notification_deliveries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    notificationId: uuid('notification_id')
      .notNull()
      .references(() => notifications.id, { onDelete: 'cascade' }),
    channel: text('channel').notNull(),
    status: notificationDeliveryStatus('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    notificationChannelIdx: uniqueIndex('notification_deliveries_notification_channel_idx').on(
      table.notificationId,
      table.channel,
    ),
    statusIdx: index('notification_deliveries_status_idx').on(table.status, table.createdAt),
  }),
)

export const documents = pgTable(
  'documents',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    content: text('content').notNull().default(''),
    crdtState: text('crdt_state'),
    createdByUserId: text('created_by_user_id').notNull(),
    updatedByUserId: text('updated_by_user_id').notNull(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    workspaceIdx: index('documents_workspace_idx').on(table.workspaceId),
    workspaceUpdatedIdx: index('documents_workspace_updated_idx').on(table.workspaceId, table.updatedAt),
  }),
)

export const documentVersions = pgTable(
  'document_versions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    versionNumber: integer('version_number').notNull(),
    title: text('title').notNull(),
    content: text('content').notNull(),
    editorUserId: text('editor_user_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    documentVersionIdx: uniqueIndex('document_versions_document_version_idx').on(
      table.documentId,
      table.versionNumber,
    ),
    documentIdx: index('document_versions_document_idx').on(table.documentId),
  }),
)

export const folders = pgTable(
  'folders',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    parentFolderId: uuid('parent_folder_id'),
    name: text('name').notNull(),
    createdByUserId: text('created_by_user_id').notNull(),
    updatedByUserId: text('updated_by_user_id').notNull(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    workspaceParentIdx: index('folders_workspace_parent_idx').on(table.workspaceId, table.parentFolderId),
    workspaceUpdatedIdx: index('folders_workspace_updated_idx').on(table.workspaceId, table.updatedAt),
  }),
)

export const files = pgTable(
  'files',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    folderId: uuid('folder_id').references(() => folders.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull().default(0),
    checksum: text('checksum'),
    uploadStatus: fileUploadStatus('upload_status').notNull().default('pending'),
    latestVersionNumber: integer('latest_version_number').notNull().default(0),
    createdByUserId: text('created_by_user_id').notNull(),
    updatedByUserId: text('updated_by_user_id').notNull(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    workspaceFolderIdx: index('files_workspace_folder_idx').on(table.workspaceId, table.folderId),
    workspaceUpdatedIdx: index('files_workspace_updated_idx').on(table.workspaceId, table.updatedAt),
  }),
)

export const fileVersions = pgTable(
  'file_versions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    fileId: uuid('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    versionNumber: integer('version_number').notNull(),
    objectKey: text('object_key').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    checksum: text('checksum'),
    uploadStatus: fileUploadStatus('upload_status').notNull().default('pending'),
    createdByUserId: text('created_by_user_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    fileVersionIdx: uniqueIndex('file_versions_file_version_idx').on(table.fileId, table.versionNumber),
    objectKeyIdx: uniqueIndex('file_versions_object_key_idx').on(table.objectKey),
    fileIdx: index('file_versions_file_idx').on(table.fileId),
  }),
)

export const fileBlocks = pgTable(
  'file_blocks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    checksum: text('checksum').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    objectKey: text('object_key').notNull(),
    createdByUserId: text('created_by_user_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    checksumSizeIdx: uniqueIndex('file_blocks_checksum_size_idx').on(table.checksum, table.sizeBytes),
    objectKeyIdx: uniqueIndex('file_blocks_object_key_idx').on(table.objectKey),
  }),
)

export const fileVersionBlocks = pgTable(
  'file_version_blocks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    fileVersionId: uuid('file_version_id')
      .notNull()
      .references(() => fileVersions.id, { onDelete: 'cascade' }),
    blockId: uuid('block_id')
      .notNull()
      .references(() => fileBlocks.id, { onDelete: 'restrict' }),
    blockIndex: integer('block_index').notNull(),
    checksum: text('checksum').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    objectKey: text('object_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    versionIndexIdx: uniqueIndex('file_version_blocks_version_index_idx').on(table.fileVersionId, table.blockIndex),
    blockIdx: index('file_version_blocks_block_idx').on(table.blockId),
  }),
)

export const uploadSessions = pgTable(
  'upload_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    fileId: uuid('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    versionId: uuid('version_id')
      .notNull()
      .references(() => fileVersions.id, { onDelete: 'cascade' }),
    createdByUserId: text('created_by_user_id').notNull(),
    fileName: text('file_name').notNull(),
    mimeType: text('mime_type').notNull(),
    totalSizeBytes: integer('total_size_bytes').notNull(),
    blockSizeBytes: integer('block_size_bytes').notNull(),
    totalBlocks: integer('total_blocks').notNull(),
    uploadedBlocks: integer('uploaded_blocks').notNull().default(0),
    status: uploadSessionStatus('status').notNull().default('pending'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    workspaceStatusIdx: index('upload_sessions_workspace_status_idx').on(table.workspaceId, table.status, table.expiresAt),
    fileIdx: index('upload_sessions_file_idx').on(table.fileId, table.versionId),
  }),
)

export const uploadSessionBlocks = pgTable(
  'upload_session_blocks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => uploadSessions.id, { onDelete: 'cascade' }),
    blockIndex: integer('block_index').notNull(),
    objectKey: text('object_key').notNull(),
    checksum: text('checksum'),
    sizeBytes: integer('size_bytes'),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    sessionIndexIdx: uniqueIndex('upload_session_blocks_session_index_idx').on(table.sessionId, table.blockIndex),
    objectKeyIdx: uniqueIndex('upload_session_blocks_object_key_idx').on(table.objectKey),
  }),
)

export const publicShareLinks = pgTable(
  'public_share_links',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    resourceType: resourceType('resource_type').notNull(),
    resourceId: uuid('resource_id').notNull(),
    token: text('token').notNull(),
    passwordHash: text('password_hash'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    accessCount: integer('access_count').notNull().default(0),
    lastAccessedAt: timestamp('last_accessed_at', { withTimezone: true }),
    createdByUserId: text('created_by_user_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    tokenIdx: uniqueIndex('public_share_links_token_idx').on(table.token),
    resourceIdx: index('public_share_links_resource_idx').on(
      table.workspaceId,
      table.resourceType,
      table.resourceId,
      table.revokedAt,
    ),
  }),
)

export const searchQueries = pgTable(
  'search_queries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    query: text('query').notNull(),
    normalizedQuery: text('normalized_query').notNull(),
    resultCount: integer('result_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    workspaceQueryIdx: index('search_queries_workspace_query_idx').on(
      table.workspaceId,
      table.normalizedQuery,
      table.createdAt,
    ),
  }),
)

export const workspacesRelations = relations(workspaces, ({ many }) => ({
  members: many(workspaceMembers),
  documents: many(documents),
  folders: many(folders),
  files: many(files),
  chatChannels: many(chatChannels),
  activityEvents: many(activityEvents),
  uploadSessions: many(uploadSessions),
  publicShareLinks: many(publicShareLinks),
}))

export const workspaceMembersRelations = relations(workspaceMembers, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [workspaceMembers.workspaceId],
    references: [workspaces.id],
  }),
}))

export const workspaceInvitesRelations = relations(workspaceInvites, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [workspaceInvites.workspaceId],
    references: [workspaces.id],
  }),
}))

export const documentsRelations = relations(documents, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [documents.workspaceId],
    references: [workspaces.id],
  }),
  versions: many(documentVersions),
}))

export const documentVersionsRelations = relations(documentVersions, ({ one }) => ({
  document: one(documents, {
    fields: [documentVersions.documentId],
    references: [documents.id],
  }),
}))

export const foldersRelations = relations(folders, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [folders.workspaceId],
    references: [workspaces.id],
  }),
  files: many(files),
}))

export const filesRelations = relations(files, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [files.workspaceId],
    references: [workspaces.id],
  }),
  folder: one(folders, {
    fields: [files.folderId],
    references: [folders.id],
  }),
  versions: many(fileVersions),
  uploadSessions: many(uploadSessions),
}))

export const fileVersionsRelations = relations(fileVersions, ({ one, many }) => ({
  file: one(files, {
    fields: [fileVersions.fileId],
    references: [files.id],
  }),
  blocks: many(fileVersionBlocks),
}))

export const fileBlocksRelations = relations(fileBlocks, ({ many }) => ({
  versionBlocks: many(fileVersionBlocks),
}))

export const fileVersionBlocksRelations = relations(fileVersionBlocks, ({ one }) => ({
  version: one(fileVersions, {
    fields: [fileVersionBlocks.fileVersionId],
    references: [fileVersions.id],
  }),
  block: one(fileBlocks, {
    fields: [fileVersionBlocks.blockId],
    references: [fileBlocks.id],
  }),
}))

export const uploadSessionsRelations = relations(uploadSessions, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [uploadSessions.workspaceId],
    references: [workspaces.id],
  }),
  file: one(files, {
    fields: [uploadSessions.fileId],
    references: [files.id],
  }),
  version: one(fileVersions, {
    fields: [uploadSessions.versionId],
    references: [fileVersions.id],
  }),
  blocks: many(uploadSessionBlocks),
}))

export const uploadSessionBlocksRelations = relations(uploadSessionBlocks, ({ one }) => ({
  session: one(uploadSessions, {
    fields: [uploadSessionBlocks.sessionId],
    references: [uploadSessions.id],
  }),
}))

export const publicShareLinksRelations = relations(publicShareLinks, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [publicShareLinks.workspaceId],
    references: [workspaces.id],
  }),
}))

export const chatChannelsRelations = relations(chatChannels, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [chatChannels.workspaceId],
    references: [workspaces.id],
  }),
  messages: many(chatMessages),
}))

export const chatMessagesRelations = relations(chatMessages, ({ one }) => ({
  channel: one(chatChannels, {
    fields: [chatMessages.channelId],
    references: [chatChannels.id],
  }),
}))

export const backgroundJobsRelations = relations(backgroundJobs, ({ one, many }) => ({
  outboxEvent: one(outboxEvents, {
    fields: [backgroundJobs.outboxEventId],
    references: [outboxEvents.id],
  }),
  attempts: many(jobAttempts),
}))

export const jobAttemptsRelations = relations(jobAttempts, ({ one }) => ({
  job: one(backgroundJobs, {
    fields: [jobAttempts.jobId],
    references: [backgroundJobs.id],
  }),
}))

export const notificationDeliveriesRelations = relations(notificationDeliveries, ({ one }) => ({
  notification: one(notifications, {
    fields: [notificationDeliveries.notificationId],
    references: [notifications.id],
  }),
}))
