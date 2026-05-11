import { relations, sql } from 'drizzle-orm'
import { index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

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
])

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

export const workspacesRelations = relations(workspaces, ({ many }) => ({
  members: many(workspaceMembers),
  documents: many(documents),
  folders: many(folders),
  files: many(files),
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
}))

export const fileVersionsRelations = relations(fileVersions, ({ one }) => ({
  file: one(files, {
    fields: [fileVersions.fileId],
    references: [files.id],
  }),
}))
