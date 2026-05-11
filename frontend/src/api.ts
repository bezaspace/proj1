export type Workspace = {
  id: string
  name: string
  role: 'owner' | 'admin' | 'member' | 'viewer'
  createdAt: string
  updatedAt: string
}

export type WorkspaceRole = Workspace['role']
export type ResourcePermissionLevel = 'view' | 'edit' | 'owner'

export type Document = {
  id: string
  workspaceId: string
  title: string
  content: string
  createdByUserId: string
  updatedByUserId: string
  archivedAt: string | null
  createdAt: string
  updatedAt: string
  effectivePermission: ResourcePermissionLevel
  sharedWithMe: boolean
}

export type DocumentVersion = {
  id: string
  documentId: string
  versionNumber: number
  title: string
  content: string
  editorUserId: string
  createdAt: string
}

export type Folder = {
  id: string
  workspaceId: string
  parentFolderId: string | null
  name: string
  createdByUserId: string
  updatedByUserId: string
  archivedAt: string | null
  createdAt: string
  updatedAt: string
}

export type DriveFile = {
  id: string
  workspaceId: string
  folderId: string | null
  name: string
  mimeType: string
  sizeBytes: number
  checksum: string | null
  uploadStatus: 'pending' | 'uploaded' | 'failed'
  latestVersionNumber: number
  createdByUserId: string
  updatedByUserId: string
  archivedAt: string | null
  createdAt: string
  updatedAt: string
  effectivePermission: ResourcePermissionLevel
  sharedWithMe: boolean
}

export type WorkspaceMember = {
  id: string
  workspaceId: string
  userId: string
  role: WorkspaceRole
  createdAt: string
  updatedAt: string
  userName: string
  userEmail: string
}

export type WorkspaceInvite = {
  id: string
  workspaceId: string
  workspaceName?: string
  email: string
  role: WorkspaceRole
  status: 'pending' | 'accepted' | 'revoked' | 'expired'
  invitedByUserId: string
  acceptedByUserId: string | null
  expiresAt: string
  acceptedAt: string | null
  revokedAt: string | null
  createdAt: string
  updatedAt: string
}

export type ResourceGrant = {
  id: string
  workspaceId: string
  resourceType: 'document' | 'file'
  resourceId: string
  userId: string
  level: ResourcePermissionLevel
  grantedByUserId: string
  createdAt: string
  updatedAt: string
  userName: string
  userEmail: string
}

export type Notification = {
  id: string
  recipientUserId: string
  actorUserId: string
  workspaceId: string | null
  type: 'workspace_invite' | 'document_shared' | 'file_shared' | 'document_updated' | 'chat_mention'
  entityType: string
  entityId: string
  title: string
  body: string
  metadata: string | null
  readAt: string | null
  createdAt: string
}

export type ChatChannel = {
  id: string
  workspaceId: string
  name: string
  createdByUserId: string
  archivedAt: string | null
  createdAt: string
  updatedAt: string
}

export type ChatMessage = {
  id: string
  workspaceId: string
  channelId: string
  senderUserId: string
  clientMessageId: string
  sequenceNumber: number
  body: string
  createdAt: string
  editedAt: string | null
  archivedAt: string | null
  senderName: string
  senderEmail: string
}

export type ActivityEvent = {
  id: string
  workspaceId: string
  actorUserId: string | null
  actorName: string | null
  actorEmail: string | null
  eventType: string
  entityType: string
  entityId: string
  summary: string
  metadata: string
  createdAt: string
}

export type SearchResult = {
  type: 'document' | 'file' | 'chat'
  id: string
  title: string
  excerpt?: string
  mimeType?: string
  sizeBytes?: number
  channelId?: string
  createdAt?: string
  updatedAt?: string
}

export type SearchSuggestion = {
  value: string
  type: 'query' | 'document' | 'file'
  count?: number
}

export type PublicShareLink = {
  id: string
  workspaceId: string
  resourceType: 'document' | 'file'
  resourceId: string
  token: string
  passwordHash: 'set' | null
  expiresAt: string | null
  revokedAt: string | null
  accessCount: number
  lastAccessedAt: string | null
  createdByUserId: string
  createdAt: string
  updatedAt: string
}

export type FileVersion = {
  id: string
  fileId: string
  versionNumber: number
  objectKey: string
  mimeType: string
  sizeBytes: number
  checksum: string | null
  uploadStatus: 'pending' | 'uploaded' | 'failed'
  createdByUserId: string
  createdAt: string
}

export type DriveListing = {
  currentFolderId: string | null
  folders: Folder[]
  files: DriveFile[]
  nextCursor: number | null
}

export type UploadIntent = {
  file: DriveFile
  version: FileVersion
  uploadUrl: string
  expiresInSeconds: number
  maxUploadBytes: number
}

export type UploadSession = {
  id: string
  workspaceId: string
  fileId: string
  versionId: string
  createdByUserId: string
  fileName: string
  mimeType: string
  totalSizeBytes: number
  blockSizeBytes: number
  totalBlocks: number
  uploadedBlocks: number
  status: 'pending' | 'completed' | 'failed' | 'expired'
  expiresAt: string
  completedAt: string | null
  lastError: string | null
  createdAt: string
  updatedAt: string
}

export type UploadSessionBlock = {
  id: string
  sessionId: string
  blockIndex: number
  objectKey: string
  checksum: string | null
  sizeBytes: number | null
  uploadedAt: string | null
  createdAt: string
  updatedAt: string
}

async function request<T>(path: string, options: RequestInit = {}) {
  const response = await fetch(path, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })

  const payload = (await response.json().catch(() => null)) as unknown

  if (!response.ok) {
    const message =
      payload &&
      typeof payload === 'object' &&
      'error' in payload &&
      typeof (payload as { error?: unknown }).error === 'string'
        ? (payload as { error: string }).error
        : 'Request failed'
    throw new Error(message)
  }

  return payload as T
}

export function getWorkspaces() {
  return request<{ workspaces: Workspace[] }>('/api/workspaces')
}

export function createWorkspace(name: string) {
  return request<{ workspace: Workspace }>('/api/workspaces', {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
}

export function getWorkspaceMembers(workspaceId: string) {
  return request<{ members: WorkspaceMember[] }>(`/api/workspaces/${workspaceId}/members`)
}

export function getWorkspaceInvites(workspaceId: string) {
  return request<{ invites: WorkspaceInvite[] }>(`/api/workspaces/${workspaceId}/invites`)
}

export function createWorkspaceInvite(workspaceId: string, input: { email: string; role: WorkspaceRole }) {
  return request<{ invite: WorkspaceInvite }>(`/api/workspaces/${workspaceId}/invites`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function revokeWorkspaceInvite(workspaceId: string, inviteId: string) {
  return request<{ invite: WorkspaceInvite }>(`/api/workspaces/${workspaceId}/invites/${inviteId}`, {
    method: 'DELETE',
  })
}

export function getMyInvites() {
  return request<{ invites: WorkspaceInvite[] }>('/api/invites')
}

export function acceptInvite(inviteId: string) {
  return request<{ invite: WorkspaceInvite; workspace: Workspace }>(`/api/invites/${inviteId}/accept`, {
    method: 'POST',
  })
}

export function getDocuments(workspaceId: string) {
  return request<{ documents: Document[] }>(`/api/workspaces/${workspaceId}/documents`)
}

export function createDocument(workspaceId: string, title = 'Untitled document') {
  return request<{ document: Document }>(`/api/workspaces/${workspaceId}/documents`, {
    method: 'POST',
    body: JSON.stringify({ title }),
  })
}

export function updateDocument(workspaceId: string, documentId: string, input: { title: string; content: string }) {
  return request<{ document: Document }>(`/api/workspaces/${workspaceId}/documents/${documentId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

export function archiveDocument(workspaceId: string, documentId: string) {
  return request<{ document: Document }>(`/api/workspaces/${workspaceId}/documents/${documentId}`, {
    method: 'DELETE',
  })
}

export function getDocumentVersions(workspaceId: string, documentId: string) {
  return request<{ versions: DocumentVersion[] }>(`/api/workspaces/${workspaceId}/documents/${documentId}/versions`)
}

export function getDocumentPermissions(workspaceId: string, documentId: string) {
  return request<{ grants: ResourceGrant[] }>(`/api/workspaces/${workspaceId}/documents/${documentId}/permissions`)
}

export function shareDocument(
  workspaceId: string,
  documentId: string,
  input: { email: string; level: ResourcePermissionLevel },
) {
  return request<{ grant: ResourceGrant }>(`/api/workspaces/${workspaceId}/documents/${documentId}/permissions`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function revokeDocumentPermission(workspaceId: string, documentId: string, permissionId: string) {
  return request<{ grant: ResourceGrant }>(
    `/api/workspaces/${workspaceId}/documents/${documentId}/permissions/${permissionId}`,
    { method: 'DELETE' },
  )
}

export function getDriveItems(workspaceId: string, folderId: string | null, cursor = 0) {
  const params = new URLSearchParams({ cursor: String(cursor), limit: '50' })
  if (folderId) {
    params.set('folderId', folderId)
  }

  return request<DriveListing>(`/api/workspaces/${workspaceId}/drive?${params.toString()}`)
}

export function createFolder(workspaceId: string, input: { name: string; parentFolderId: string | null }) {
  return request<{ folder: Folder }>(`/api/workspaces/${workspaceId}/folders`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function renameFolder(workspaceId: string, folderId: string, name: string) {
  return request<{ folder: Folder }>(`/api/workspaces/${workspaceId}/folders/${folderId}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  })
}

export function archiveFolder(workspaceId: string, folderId: string) {
  return request<{ archivedFolderIds: string[] }>(`/api/workspaces/${workspaceId}/folders/${folderId}`, {
    method: 'DELETE',
  })
}

export function createFileUploadIntent(
  workspaceId: string,
  input: { name: string; folderId: string | null; mimeType: string; sizeBytes: number; checksum?: string | null },
) {
  return request<UploadIntent>(`/api/workspaces/${workspaceId}/files/upload-intents`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function createFileUploadSession(
  workspaceId: string,
  input: {
    name: string
    folderId: string | null
    mimeType: string
    sizeBytes: number
    checksum?: string | null
    blockSizeBytes?: number
  },
) {
  return request<{
    file: DriveFile
    version: FileVersion
    session: UploadSession
    expiresInSeconds: number
    minComposableBlockBytes: number
  }>(`/api/workspaces/${workspaceId}/files/upload-sessions`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function getUploadSession(workspaceId: string, sessionId: string) {
  return request<{ session: UploadSession; blocks: UploadSessionBlock[] }>(
    `/api/workspaces/${workspaceId}/files/upload-sessions/${sessionId}`,
  )
}

export function createBlockUploadIntent(workspaceId: string, sessionId: string, blockIndex: number) {
  return request<{ block: UploadSessionBlock; uploadUrl: string; expiresInSeconds: number }>(
    `/api/workspaces/${workspaceId}/files/upload-sessions/${sessionId}/blocks/${blockIndex}/upload-intent`,
    { method: 'POST' },
  )
}

export function completeUploadBlock(
  workspaceId: string,
  sessionId: string,
  blockIndex: number,
  input: { checksum: string; sizeBytes: number },
) {
  return request<{ block: UploadSessionBlock; deduped: boolean; uploadedBlocks: number }>(
    `/api/workspaces/${workspaceId}/files/upload-sessions/${sessionId}/blocks/${blockIndex}/complete`,
    { method: 'POST', body: JSON.stringify(input) },
  )
}

export function completeUploadSession(workspaceId: string, sessionId: string) {
  return request<{ file: DriveFile; version: FileVersion; sessionId: string }>(
    `/api/workspaces/${workspaceId}/files/upload-sessions/${sessionId}/complete`,
    { method: 'POST' },
  )
}

export function createReplacementUploadIntent(
  workspaceId: string,
  fileId: string,
  input: { mimeType: string; sizeBytes: number; checksum?: string | null },
) {
  return request<UploadIntent>(`/api/workspaces/${workspaceId}/files/${fileId}/replacement-upload-intents`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function completeFileUpload(workspaceId: string, fileId: string, versionId: string) {
  return request<{ file: DriveFile; version: FileVersion }>(
    `/api/workspaces/${workspaceId}/files/${fileId}/versions/${versionId}/complete`,
    { method: 'POST' },
  )
}

export function getFileVersions(workspaceId: string, fileId: string) {
  return request<{ versions: FileVersion[] }>(`/api/workspaces/${workspaceId}/files/${fileId}/versions`)
}

export function getFilePermissions(workspaceId: string, fileId: string) {
  return request<{ grants: ResourceGrant[] }>(`/api/workspaces/${workspaceId}/files/${fileId}/permissions`)
}

export function shareFile(workspaceId: string, fileId: string, input: { email: string; level: ResourcePermissionLevel }) {
  return request<{ grant: ResourceGrant }>(`/api/workspaces/${workspaceId}/files/${fileId}/permissions`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function revokeFilePermission(workspaceId: string, fileId: string, permissionId: string) {
  return request<{ grant: ResourceGrant }>(`/api/workspaces/${workspaceId}/files/${fileId}/permissions/${permissionId}`, {
    method: 'DELETE',
  })
}

export function getFileDownload(workspaceId: string, fileId: string) {
  return request<{ downloadUrl: string; expiresInSeconds: number }>(`/api/workspaces/${workspaceId}/files/${fileId}/download`)
}

export function getFileVersionDownload(workspaceId: string, fileId: string, versionId: string) {
  return request<{ downloadUrl: string; expiresInSeconds: number }>(
    `/api/workspaces/${workspaceId}/files/${fileId}/versions/${versionId}/download`,
  )
}

export function updateFile(workspaceId: string, fileId: string, input: { name?: string; folderId?: string | null }) {
  return request<{ file: DriveFile }>(`/api/workspaces/${workspaceId}/files/${fileId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

export function archiveFile(workspaceId: string, fileId: string) {
  return request<{ file: DriveFile }>(`/api/workspaces/${workspaceId}/files/${fileId}`, {
    method: 'DELETE',
  })
}

export function getNotifications(unreadOnly = false) {
  const params = unreadOnly ? '?unreadOnly=true' : ''
  return request<{ notifications: Notification[] }>(`/api/notifications${params}`)
}

export function getUnreadNotificationCount() {
  return request<{ unreadCount: number }>('/api/notifications/unread-count')
}

export function markNotificationRead(notificationId: string) {
  return request<{ notification: Notification }>(`/api/notifications/${notificationId}/read`, {
    method: 'PATCH',
  })
}

export function markAllNotificationsRead() {
  return request<{ updatedCount: number }>('/api/notifications/mark-all-read', {
    method: 'POST',
  })
}

export function getChatChannels(workspaceId: string) {
  return request<{ channels: ChatChannel[] }>(`/api/workspaces/${workspaceId}/channels`)
}

export function createChatChannel(workspaceId: string, name: string) {
  return request<{ channel: ChatChannel }>(`/api/workspaces/${workspaceId}/channels`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
}

export function getChatMessages(workspaceId: string, channelId: string, beforeSequence?: number | null) {
  const params = new URLSearchParams({ limit: '50' })
  if (beforeSequence) {
    params.set('beforeSequence', String(beforeSequence))
  }

  return request<{ messages: ChatMessage[]; nextCursor: number | null }>(
    `/api/workspaces/${workspaceId}/channels/${channelId}/messages?${params.toString()}`,
  )
}

export function getWorkspaceActivity(workspaceId: string, cursor?: string | null) {
  const params = new URLSearchParams({ limit: '50' })
  if (cursor) {
    params.set('cursor', cursor)
  }

  return request<{ activity: ActivityEvent[]; nextCursor: string | null }>(
    `/api/workspaces/${workspaceId}/activity?${params.toString()}`,
  )
}

export function searchWorkspace(workspaceId: string, query: string, type: 'all' | 'documents' | 'files' | 'chat' = 'all') {
  const params = new URLSearchParams({ q: query, type, limit: '20' })
  return request<{ query: string; results: SearchResult[] }>(`/api/workspaces/${workspaceId}/search?${params.toString()}`)
}

export function autocompleteWorkspace(workspaceId: string, query: string) {
  const params = new URLSearchParams({ q: query, limit: '8' })
  return request<{ suggestions: SearchSuggestion[] }>(`/api/workspaces/${workspaceId}/autocomplete?${params.toString()}`)
}

export function getPublicShareLinks(workspaceId: string, resourceType?: 'document' | 'file', resourceId?: string) {
  const params = new URLSearchParams()
  if (resourceType && resourceId) {
    params.set('resourceType', resourceType)
    params.set('resourceId', resourceId)
  }

  const query = params.toString()
  return request<{ links: PublicShareLink[] }>(`/api/workspaces/${workspaceId}/share-links${query ? `?${query}` : ''}`)
}

export function createPublicShareLink(
  workspaceId: string,
  input: { resourceType: 'document' | 'file'; resourceId: string; password?: string | null; expiresAt?: string | null },
) {
  return request<{ link: PublicShareLink }>(`/api/workspaces/${workspaceId}/share-links`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function revokePublicShareLink(workspaceId: string, linkId: string) {
  return request<{ link: PublicShareLink }>(`/api/workspaces/${workspaceId}/share-links/${linkId}`, {
    method: 'DELETE',
  })
}
