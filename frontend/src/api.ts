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
  type: 'workspace_invite' | 'document_shared' | 'file_shared'
    | 'document_updated'
  entityType: string
  entityId: string
  title: string
  body: string
  metadata: string | null
  readAt: string | null
  createdAt: string
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
