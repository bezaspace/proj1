import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import * as Y from 'yjs'
import {
  acceptInvite,
  archiveDocument,
  archiveFile,
  archiveFolder,
  completeFileUpload,
  createChatChannel,
  createDocument,
  createFileUploadIntent,
  createFolder,
  createReplacementUploadIntent,
  createWorkspace,
  createWorkspaceInvite,
  getDocumentPermissions,
  getDocumentVersions,
  getDocuments,
  getChatChannels,
  getChatMessages,
  getDriveItems,
  getFileDownload,
  getFilePermissions,
  getFileVersionDownload,
  getFileVersions,
  getMyInvites,
  getNotifications,
  getUnreadNotificationCount,
  getWorkspaces,
  getWorkspaceInvites,
  getWorkspaceMembers,
  getWorkspaceActivity,
  markAllNotificationsRead,
  markNotificationRead,
  renameFolder,
  revokeDocumentPermission,
  revokeFilePermission,
  revokeWorkspaceInvite,
  shareDocument,
  shareFile,
  updateDocument,
  updateFile,
  type Document,
  type DocumentVersion,
  type DriveFile,
  type FileVersion,
  type Folder,
  type ActivityEvent,
  type ChatChannel,
  type ChatMessage,
  type Notification,
  type ResourceGrant,
  type ResourcePermissionLevel,
  type Workspace,
  type WorkspaceInvite,
  type WorkspaceMember,
  type WorkspaceRole,
} from './api'
import { signIn, signOut, signUp, useSession } from './auth-client'

type AuthMode = 'signup' | 'login'
type AppView = 'documents' | 'files' | 'chat' | 'activity' | 'people'
type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'live'
type FolderCrumb = { id: string | null; name: string }
type RealtimeStatus = 'disconnected' | 'connecting' | 'connected'
type Collaborator = { userId: string; name: string; email: string; connectionCount: number }
type OnlineMember = Collaborator
type TypingMember = { userId: string; name: string; email: string }

type RealtimeMessage =
  | { type: 'ready' }
  | {
      type: 'document.state'
      workspaceId: string
      documentId: string
      title: string
      update: string
      effectivePermission: ResourcePermissionLevel
      collaborators: Collaborator[]
    }
  | { type: 'document.update'; workspaceId: string; documentId: string; update: string; userId: string | null }
  | { type: 'document.presence'; workspaceId: string; documentId: string; collaborators: Collaborator[] }
  | { type: 'workspace.presence'; workspaceId: string; members: OnlineMember[] }
  | {
      type: 'chat.message.ack'
      workspaceId: string
      channelId: string
      clientMessageId: string
      message: ChatMessage
      duplicate: boolean
    }
  | { type: 'chat.message.created'; workspaceId: string; channelId: string; message: ChatMessage }
  | {
      type: 'chat.typing'
      workspaceId: string
      channelId: string
      userId: string
      name: string
      email: string
      isTyping: boolean
    }
  | {
      type: 'document.snapshot.saved'
      workspaceId: string
      documentId: string
      title: string
      versionNumber: number
      document: Document
    }
  | { type: 'notification.created'; notification: Notification; unreadCount: number }
  | { type: 'error'; error: string }

function encodeUpdate(update: Uint8Array) {
  let binary = ''
  update.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return window.btoa(binary)
}

function decodeUpdate(value: string) {
  const binary = window.atob(value)
  const update = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index += 1) {
    update[index] = binary.charCodeAt(index)
  }

  return update
}

function formatBytes(value: number) {
  if (value < 1024) {
    return `${value} B`
  }

  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`
  }

  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

function uploadToSignedUrl(url: string, file: File, onProgress: (progress: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('PUT', url)
    request.setRequestHeader('Content-Type', file.type || 'application/octet-stream')

    request.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100))
      }
    }

    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress(100)
        resolve()
        return
      }

      reject(new Error('Object storage rejected the upload.'))
    }

    request.onerror = () => reject(new Error('Could not reach object storage.'))
    request.send(file)
  })
}

function canEditPermission(level: ResourcePermissionLevel | undefined) {
  return level === 'edit' || level === 'owner'
}

function canSharePermission(level: ResourcePermissionLevel | undefined) {
  return level === 'owner'
}

function App() {
  const session = useSession()
  const [appView, setAppView] = useState<AppView>('documents')
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null)
  const [workspaceName, setWorkspaceName] = useState('')
  const [workspaceError, setWorkspaceError] = useState('')
  const [isCreatingWorkspace, setIsCreatingWorkspace] = useState(false)
  const [documents, setDocuments] = useState<Document[]>([])
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null)
  const [documentTitle, setDocumentTitle] = useState('')
  const [documentContent, setDocumentContent] = useState('')
  const [documentError, setDocumentError] = useState('')
  const [documentVersions, setDocumentVersions] = useState<DocumentVersion[]>([])
  const [selectedDocumentVersionId, setSelectedDocumentVersionId] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [isCreatingDocument, setIsCreatingDocument] = useState(false)
  const [isArchivingDocument, setIsArchivingDocument] = useState(false)
  const [driveFolders, setDriveFolders] = useState<Folder[]>([])
  const [driveFiles, setDriveFiles] = useState<DriveFile[]>([])
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null)
  const [folderStack, setFolderStack] = useState<FolderCrumb[]>([{ id: null, name: 'Files' }])
  const [newFolderName, setNewFolderName] = useState('')
  const [fileError, setFileError] = useState('')
  const [fileVersions, setFileVersions] = useState<FileVersion[]>([])
  const [nextFileCursor, setNextFileCursor] = useState<number | null>(null)
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)
  const [isCreatingFolder, setIsCreatingFolder] = useState(false)
  const [isUploadingFile, setIsUploadingFile] = useState(false)
  const [members, setMembers] = useState<WorkspaceMember[]>([])
  const [workspaceInvites, setWorkspaceInvites] = useState<WorkspaceInvite[]>([])
  const [myInvites, setMyInvites] = useState<WorkspaceInvite[]>([])
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<WorkspaceRole>('viewer')
  const [peopleError, setPeopleError] = useState('')
  const [isInviting, setIsInviting] = useState(false)
  const [documentGrants, setDocumentGrants] = useState<ResourceGrant[]>([])
  const [fileGrants, setFileGrants] = useState<ResourceGrant[]>([])
  const [documentShareEmail, setDocumentShareEmail] = useState('')
  const [fileShareEmail, setFileShareEmail] = useState('')
  const [documentShareLevel, setDocumentShareLevel] = useState<ResourcePermissionLevel>('view')
  const [fileShareLevel, setFileShareLevel] = useState<ResourcePermissionLevel>('view')
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [showNotifications, setShowNotifications] = useState(false)
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>('disconnected')
  const [collaborators, setCollaborators] = useState<Collaborator[]>([])
  const [onlineMembers, setOnlineMembers] = useState<OnlineMember[]>([])
  const [chatChannels, setChatChannels] = useState<ChatChannel[]>([])
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatDraft, setChatDraft] = useState('')
  const [newChannelName, setNewChannelName] = useState('')
  const [chatError, setChatError] = useState('')
  const [isCreatingChannel, setIsCreatingChannel] = useState(false)
  const [nextMessageCursor, setNextMessageCursor] = useState<number | null>(null)
  const [typingMembers, setTypingMembers] = useState<TypingMember[]>([])
  const [activityEvents, setActivityEvents] = useState<ActivityEvent[]>([])
  const [nextActivityCursor, setNextActivityCursor] = useState<string | null>(null)
  const [activityError, setActivityError] = useState('')
  const [liveDocumentPermission, setLiveDocumentPermission] = useState<ResourcePermissionLevel | null>(null)
  const [isRealtimeRoomLoading, setIsRealtimeRoomLoading] = useState(false)
  const realtimeSocketRef = useRef<WebSocket | null>(null)
  const reconnectTimerRef = useRef<number | null>(null)
  const reconnectAttemptRef = useRef(0)
  const activeWorkspaceRef = useRef<string | null>(null)
  const typingTimerRef = useRef<number | null>(null)
  const ydocRef = useRef<Y.Doc | null>(null)
  const ytextRef = useRef<Y.Text | null>(null)
  const activeRoomRef = useRef<{ workspaceId: string; documentId: string } | null>(null)

  const selectedWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? workspaces[0],
    [selectedWorkspaceId, workspaces],
  )
  const selectedDocument = useMemo(
    () => documents.find((document) => document.id === selectedDocumentId) ?? documents[0],
    [selectedDocumentId, documents],
  )
  const selectedDocumentVersion = useMemo(
    () => documentVersions.find((version) => version.id === selectedDocumentVersionId) ?? documentVersions[0],
    [selectedDocumentVersionId, documentVersions],
  )
  const selectedFile = useMemo(
    () => driveFiles.find((file) => file.id === selectedFileId) ?? driveFiles[0],
    [selectedFileId, driveFiles],
  )
  const selectedChannel = useMemo(
    () => chatChannels.find((channel) => channel.id === selectedChannelId) ?? chatChannels[0],
    [selectedChannelId, chatChannels],
  )
  const currentFolderId = folderStack[folderStack.length - 1]?.id ?? null
  const canEditResources =
    selectedWorkspace?.role === 'owner' || selectedWorkspace?.role === 'admin' || selectedWorkspace?.role === 'member'
  const canManagePeople = selectedWorkspace?.role === 'owner' || selectedWorkspace?.role === 'admin'
  const canEditSelectedDocument = canEditPermission(liveDocumentPermission ?? selectedDocument?.effectivePermission)
  const canShareSelectedDocument = canSharePermission(selectedDocument?.effectivePermission)
  const canEditSelectedFile = canEditPermission(selectedFile?.effectivePermission)
  const canShareSelectedFile = canSharePermission(selectedFile?.effectivePermission)

  async function loadWorkspaces() {
    const payload = await getWorkspaces()
    setWorkspaces(payload.workspaces)
    setSelectedWorkspaceId((currentId) => currentId ?? payload.workspaces[0]?.id ?? null)
  }

  async function loadDocuments(workspaceId: string) {
    const payload = await getDocuments(workspaceId)
    setDocuments(payload.documents)
    setSelectedDocumentId((currentId) => {
      if (currentId && payload.documents.some((document) => document.id === currentId)) {
        return currentId
      }

      return payload.documents[0]?.id ?? null
    })
  }

  async function loadDocumentVersions(workspaceId: string, documentId: string) {
    const payload = await getDocumentVersions(workspaceId, documentId)
    setDocumentVersions(payload.versions)
    setSelectedDocumentVersionId((currentId) => {
      if (currentId && payload.versions.some((version) => version.id === currentId)) {
        return currentId
      }

      return payload.versions[0]?.id ?? null
    })
  }

  async function loadDrive(workspaceId: string, folderId: string | null, cursor = 0) {
    const payload = await getDriveItems(workspaceId, folderId, cursor)
    setDriveFolders(payload.folders)
    setDriveFiles((current) => (cursor > 0 ? [...current, ...payload.files] : payload.files))
    setNextFileCursor(payload.nextCursor)
    setSelectedFileId((currentId) => {
      const availableFiles = cursor > 0 ? [...driveFiles, ...payload.files] : payload.files
      if (currentId && availableFiles.some((file) => file.id === currentId)) {
        return currentId
      }

      return availableFiles[0]?.id ?? null
    })
  }

  async function loadFileVersions(workspaceId: string, fileId: string) {
    const payload = await getFileVersions(workspaceId, fileId)
    setFileVersions(payload.versions)
  }

  async function loadPeople(workspaceId: string) {
    const [membersPayload, invitesPayload] = await Promise.all([
      getWorkspaceMembers(workspaceId),
      canManagePeople ? getWorkspaceInvites(workspaceId) : Promise.resolve({ invites: [] }),
    ])
    setMembers(membersPayload.members)
    setWorkspaceInvites(invitesPayload.invites)
  }

  async function loadMyInvites() {
    const payload = await getMyInvites()
    setMyInvites(payload.invites)
  }

  async function loadNotifications() {
    const [notificationsPayload, countPayload] = await Promise.all([getNotifications(), getUnreadNotificationCount()])
    setNotifications(notificationsPayload.notifications)
    setUnreadCount(countPayload.unreadCount)
  }

  async function loadChatChannels(workspaceId: string) {
    const payload = await getChatChannels(workspaceId)
    setChatChannels(payload.channels)
    setSelectedChannelId((currentId) => {
      if (currentId && payload.channels.some((channel) => channel.id === currentId)) {
        return currentId
      }

      return payload.channels[0]?.id ?? null
    })
  }

  async function loadChatMessages(workspaceId: string, channelId: string, beforeSequence?: number | null) {
    const payload = await getChatMessages(workspaceId, channelId, beforeSequence)
    setChatMessages((current) => (beforeSequence ? [...payload.messages, ...current] : payload.messages))
    setNextMessageCursor(payload.nextCursor)
  }

  async function loadActivity(workspaceId: string, cursor?: string | null) {
    const payload = await getWorkspaceActivity(workspaceId, cursor)
    setActivityEvents((current) => (cursor ? [...current, ...payload.activity] : payload.activity))
    setNextActivityCursor(payload.nextCursor)
  }

  function sendRealtime(payload: unknown) {
    const socket = realtimeSocketRef.current

    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(payload))
      return true
    }

    return false
  }

  function joinActiveDocument() {
    if (!selectedWorkspace?.id || !selectedDocument?.id || realtimeSocketRef.current?.readyState !== WebSocket.OPEN) {
      return
    }

    setIsRealtimeRoomLoading(true)
    activeRoomRef.current = { workspaceId: selectedWorkspace.id, documentId: selectedDocument.id }
    sendRealtime({ type: 'document.join', workspaceId: selectedWorkspace.id, documentId: selectedDocument.id })
  }

  function joinActiveWorkspace() {
    if (!selectedWorkspace?.id || realtimeSocketRef.current?.readyState !== WebSocket.OPEN) {
      return
    }

    if (activeWorkspaceRef.current === selectedWorkspace.id) {
      return
    }

    if (activeWorkspaceRef.current) {
      sendRealtime({ type: 'workspace.leave', workspaceId: activeWorkspaceRef.current })
    }

    activeWorkspaceRef.current = selectedWorkspace.id
    sendRealtime({ type: 'workspace.join', workspaceId: selectedWorkspace.id })
  }

  function setupYjsDocument(initialContent: string) {
    ydocRef.current?.destroy()

    const ydoc = new Y.Doc()
    const ytext = ydoc.getText('content')

    ytext.observe((event) => {
      setDocumentContent(ytext.toString())

      if (event.transaction.origin === 'remote') {
        setSaveStatus('live')
      } else if (event.transaction.origin === 'local') {
        setSaveStatus('dirty')
      }
    })

    ydoc.on('update', (update, origin) => {
      const room = activeRoomRef.current

      if (origin === 'remote' || !room || !canEditPermission(liveDocumentPermission ?? selectedDocument?.effectivePermission)) {
        return
      }

      sendRealtime({
        type: 'document.update',
        workspaceId: room.workspaceId,
        documentId: room.documentId,
        update: encodeUpdate(update),
      })
    })

    ydocRef.current = ydoc
    ytextRef.current = ytext
    setDocumentContent(initialContent)
  }

  function replaceYText(value: string) {
    const ydoc = ydocRef.current
    const ytext = ytextRef.current

    if (!ydoc || !ytext) {
      setDocumentContent(value)
      setSaveStatus('dirty')
      return
    }

    ydoc.transact(() => {
      ytext.delete(0, ytext.length)
      ytext.insert(0, value)
    }, 'local')
  }

  function handleRealtimeMessage(message: RealtimeMessage) {
    const activeRoom = activeRoomRef.current

    if (message.type === 'ready') {
      setRealtimeStatus('connected')
      reconnectAttemptRef.current = 0
      joinActiveWorkspace()
      joinActiveDocument()
      return
    }

    if (message.type === 'error') {
      setDocumentError(message.error)
      return
    }

    if (message.type === 'notification.created') {
      setNotifications((current) => [message.notification, ...current.filter((item) => item.id !== message.notification.id)])
      setUnreadCount(message.unreadCount)
      return
    }

    if (message.type === 'workspace.presence') {
      if (message.workspaceId === selectedWorkspace?.id) {
        setOnlineMembers(message.members)
      }
      return
    }

    if (message.type === 'chat.message.ack' || message.type === 'chat.message.created') {
      if (message.workspaceId !== selectedWorkspace?.id || message.channelId !== selectedChannel?.id) {
        return
      }

      setChatMessages((current) => {
        if (current.some((item) => item.id === message.message.id)) {
          return current.map((item) => (item.id === message.message.id ? message.message : item))
        }

        return [...current, message.message].sort((left, right) => left.sequenceNumber - right.sequenceNumber)
      })
      return
    }

    if (message.type === 'chat.typing') {
      if (message.workspaceId !== selectedWorkspace?.id || message.channelId !== selectedChannel?.id) {
        return
      }

      if (message.userId === session.data?.user.id) {
        return
      }

      setTypingMembers((current) => {
        const remaining = current.filter((member) => member.userId !== message.userId)
        return message.isTyping ? [...remaining, { userId: message.userId, name: message.name, email: message.email }] : remaining
      })
      return
    }

    if ('workspaceId' in message && 'documentId' in message) {
      if (!activeRoom || activeRoom.workspaceId !== message.workspaceId || activeRoom.documentId !== message.documentId) {
        return
      }
    }

    if (message.type === 'document.state') {
      setDocumentTitle(message.title)
      setLiveDocumentPermission(message.effectivePermission)
      setCollaborators(message.collaborators)
      if (ydocRef.current) {
        Y.applyUpdate(ydocRef.current, decodeUpdate(message.update), 'remote')
      }
      setIsRealtimeRoomLoading(false)
      setSaveStatus('live')
      return
    }

    if (message.type === 'document.update') {
      if (ydocRef.current) {
        Y.applyUpdate(ydocRef.current, decodeUpdate(message.update), 'remote')
      }
      return
    }

    if (message.type === 'document.presence') {
      setCollaborators(message.collaborators)
      return
    }

    if (message.type === 'document.snapshot.saved') {
      setDocumentTitle(message.title)
      setSaveStatus('saved')
      setDocuments((current) =>
        current
          .map((document) => (document.id === message.document.id ? message.document : document))
          .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()),
      )
      if (selectedWorkspace?.id) {
        loadDocumentVersions(selectedWorkspace.id, message.documentId).catch(() => undefined)
      }
    }
  }

  function connectRealtime() {
    if (!session.data?.user || realtimeSocketRef.current?.readyState === WebSocket.OPEN) {
      return
    }

    setRealtimeStatus('connecting')
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const socket = new WebSocket(`${protocol}//${window.location.host}/api/realtime`)
    realtimeSocketRef.current = socket

    socket.onmessage = (event) => {
      try {
        handleRealtimeMessage(JSON.parse(event.data) as RealtimeMessage)
      } catch {
        // Ignore malformed realtime payloads; the next valid event reconciles state.
      }
    }

    socket.onclose = () => {
      setRealtimeStatus('disconnected')
      setIsRealtimeRoomLoading(false)
      realtimeSocketRef.current = null

      if (!session.data?.user) {
        return
      }

      const delay = Math.min(1000 * 2 ** reconnectAttemptRef.current, 10000)
      reconnectAttemptRef.current += 1
      reconnectTimerRef.current = window.setTimeout(connectRealtime, delay)
    }

    socket.onerror = () => {
      socket.close()
    }
  }

  async function loadDocumentGrants(workspaceId: string, documentId: string) {
    if (!canShareSelectedDocument) {
      setDocumentGrants([])
      return
    }

    const payload = await getDocumentPermissions(workspaceId, documentId)
    setDocumentGrants(payload.grants)
  }

  async function loadFileGrants(workspaceId: string, fileId: string) {
    if (!canShareSelectedFile) {
      setFileGrants([])
      return
    }

    const payload = await getFilePermissions(workspaceId, fileId)
    setFileGrants(payload.grants)
  }

  useEffect(() => {
    if (!session.data?.user) {
      realtimeSocketRef.current?.close()
      realtimeSocketRef.current = null
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
      ydocRef.current?.destroy()
      ydocRef.current = null
      ytextRef.current = null
      activeRoomRef.current = null
      activeWorkspaceRef.current = null
      setRealtimeStatus('disconnected')
      setWorkspaces([])
      setSelectedWorkspaceId(null)
      setDocuments([])
      setSelectedDocumentId(null)
      setDriveFolders([])
      setDriveFiles([])
      setSelectedFileId(null)
      setMembers([])
      setWorkspaceInvites([])
      setMyInvites([])
      setNotifications([])
      setUnreadCount(0)
      setCollaborators([])
      setOnlineMembers([])
      setChatChannels([])
      setChatMessages([])
      setActivityEvents([])
      return
    }

    connectRealtime()
    Promise.all([loadWorkspaces(), loadMyInvites(), loadNotifications()]).catch((error) => {
      setWorkspaceError(error instanceof Error ? error.message : 'Could not load workspaces')
    })
  }, [session.data?.user?.id])

  useEffect(() => {
    setFolderStack([{ id: null, name: 'Files' }])
    setDriveFolders([])
    setDriveFiles([])
    setSelectedFileId(null)
    setMembers([])
    setWorkspaceInvites([])
    setChatChannels([])
    setSelectedChannelId(null)
    setChatMessages([])
    setOnlineMembers([])
    setActivityEvents([])
    setNextActivityCursor(null)
    if (activeWorkspaceRef.current && activeWorkspaceRef.current !== selectedWorkspace?.id) {
      sendRealtime({ type: 'workspace.leave', workspaceId: activeWorkspaceRef.current })
      activeWorkspaceRef.current = null
    }
    joinActiveWorkspace()
  }, [selectedWorkspace?.id])

  useEffect(() => {
    if (!selectedWorkspace?.id) {
      setDocuments([])
      setSelectedDocumentId(null)
      return
    }

    setDocumentError('')
    loadDocuments(selectedWorkspace.id).catch((error) => {
      setDocumentError(error instanceof Error ? error.message : 'Could not load documents')
    })
  }, [selectedWorkspace?.id])

  useEffect(() => {
    if (!selectedDocument) {
      const previousRoom = activeRoomRef.current
      if (previousRoom) {
        sendRealtime({ type: 'document.leave', ...previousRoom })
      }
      activeRoomRef.current = null
      ydocRef.current?.destroy()
      ydocRef.current = null
      ytextRef.current = null
      setDocumentTitle('')
      setDocumentContent('')
      setDocumentVersions([])
      setSelectedDocumentVersionId(null)
      setSaveStatus('idle')
      setCollaborators([])
      setLiveDocumentPermission(null)
      setIsRealtimeRoomLoading(false)
      return
    }

    const previousRoom = activeRoomRef.current
    if (previousRoom) {
      sendRealtime({ type: 'document.leave', ...previousRoom })
    }

    activeRoomRef.current =
      selectedWorkspace?.id && selectedDocument.id
        ? { workspaceId: selectedWorkspace.id, documentId: selectedDocument.id }
        : null
    setDocumentTitle(selectedDocument.title)
    setLiveDocumentPermission(selectedDocument.effectivePermission)
    setCollaborators([])
    setIsRealtimeRoomLoading(realtimeSocketRef.current?.readyState === WebSocket.OPEN)
    setupYjsDocument(selectedDocument.content)
    setSaveStatus('saved')
    joinActiveDocument()

    return () => {
      const room = activeRoomRef.current
      if (room?.documentId === selectedDocument.id) {
        sendRealtime({ type: 'document.leave', ...room })
        activeRoomRef.current = null
      }
    }
  }, [selectedWorkspace?.id, selectedDocument?.id])

  useEffect(() => {
    if (appView !== 'documents' || !selectedWorkspace?.id || !selectedDocument?.id) {
      return
    }

    loadDocumentVersions(selectedWorkspace.id, selectedDocument.id).catch((error) => {
      setDocumentError(error instanceof Error ? error.message : 'Could not load document history')
    })
  }, [appView, selectedWorkspace?.id, selectedDocument?.id])

  useEffect(() => {
    if (appView !== 'files' || !selectedWorkspace?.id) {
      return
    }

    setFileError('')
    loadDrive(selectedWorkspace.id, currentFolderId).catch((error) => {
      setFileError(error instanceof Error ? error.message : 'Could not load files')
    })
  }, [appView, selectedWorkspace?.id, currentFolderId])

  useEffect(() => {
    if (appView !== 'chat' || !selectedWorkspace?.id) {
      return
    }

    setChatError('')
    loadChatChannels(selectedWorkspace.id).catch((error) => {
      setChatError(error instanceof Error ? error.message : 'Could not load channels')
    })
  }, [appView, selectedWorkspace?.id])

  useEffect(() => {
    if (appView !== 'chat' || !selectedWorkspace?.id || !selectedChannel?.id) {
      setChatMessages([])
      setTypingMembers([])
      return
    }

    loadChatMessages(selectedWorkspace.id, selectedChannel.id).catch((error) => {
      setChatError(error instanceof Error ? error.message : 'Could not load messages')
    })
  }, [appView, selectedWorkspace?.id, selectedChannel?.id])

  useEffect(() => {
    if (appView !== 'activity' || !selectedWorkspace?.id) {
      return
    }

    setActivityError('')
    loadActivity(selectedWorkspace.id).catch((error) => {
      setActivityError(error instanceof Error ? error.message : 'Could not load activity')
    })
  }, [appView, selectedWorkspace?.id])

  useEffect(() => {
    if (appView !== 'files' || !selectedWorkspace?.id || !selectedFile?.id) {
      setFileVersions([])
      return
    }

    loadFileVersions(selectedWorkspace.id, selectedFile.id).catch((error) => {
      setFileError(error instanceof Error ? error.message : 'Could not load file versions')
    })
  }, [appView, selectedWorkspace?.id, selectedFile?.id])

  useEffect(() => {
    if (!selectedWorkspace?.id) {
      return
    }

    loadPeople(selectedWorkspace.id).catch((error) => {
      setPeopleError(error instanceof Error ? error.message : 'Could not load people')
    })
  }, [selectedWorkspace?.id, canManagePeople])

  useEffect(() => {
    if (!selectedWorkspace?.id || !selectedDocument?.id) {
      setDocumentGrants([])
      return
    }

    loadDocumentGrants(selectedWorkspace.id, selectedDocument.id).catch(() => {
      setDocumentGrants([])
    })
  }, [selectedWorkspace?.id, selectedDocument?.id, selectedDocument?.effectivePermission])

  useEffect(() => {
    if (!selectedWorkspace?.id || !selectedFile?.id) {
      setFileGrants([])
      return
    }

    loadFileGrants(selectedWorkspace.id, selectedFile.id).catch(() => {
      setFileGrants([])
    })
  }, [selectedWorkspace?.id, selectedFile?.id, selectedFile?.effectivePermission])

  async function handleCreateWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setWorkspaceError('')
    setIsCreatingWorkspace(true)

    try {
      const payload = await createWorkspace(workspaceName)
      setWorkspaces((current) => [payload.workspace, ...current])
      setSelectedWorkspaceId(payload.workspace.id)
      setWorkspaceName('')
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : 'Could not create workspace')
    } finally {
      setIsCreatingWorkspace(false)
    }
  }

  async function handleCreateDocument() {
    if (!selectedWorkspace) {
      return
    }

    setDocumentError('')
    setIsCreatingDocument(true)

    try {
      const payload = await createDocument(selectedWorkspace.id)
      setDocuments((current) => [payload.document, ...current])
      setSelectedDocumentId(payload.document.id)
    } catch (error) {
      setDocumentError(error instanceof Error ? error.message : 'Could not create document')
    } finally {
      setIsCreatingDocument(false)
    }
  }

  async function handleSaveDocument() {
    if (!selectedWorkspace || !selectedDocument) {
      return
    }

    setDocumentError('')
    setSaveStatus('saving')

    try {
      if (
        realtimeSocketRef.current?.readyState === WebSocket.OPEN &&
        activeRoomRef.current?.workspaceId === selectedWorkspace.id &&
        activeRoomRef.current?.documentId === selectedDocument.id
      ) {
        sendRealtime({
          type: 'document.snapshot',
          workspaceId: selectedWorkspace.id,
          documentId: selectedDocument.id,
          title: documentTitle,
        })
        return
      }

      const payload = await updateDocument(selectedWorkspace.id, selectedDocument.id, {
        title: documentTitle,
        content: documentContent,
      })
      setDocuments((current) =>
        current
          .map((document) => (document.id === payload.document.id ? payload.document : document))
          .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()),
      )
      await loadDocumentVersions(selectedWorkspace.id, payload.document.id)
      setSaveStatus('saved')
    } catch (error) {
      setSaveStatus('dirty')
      setDocumentError(error instanceof Error ? error.message : 'Could not save document')
    }
  }

  async function handleArchiveDocument() {
    if (!selectedWorkspace || !selectedDocument) {
      return
    }

    setDocumentError('')
    setIsArchivingDocument(true)

    try {
      await archiveDocument(selectedWorkspace.id, selectedDocument.id)
      setDocuments((current) => current.filter((document) => document.id !== selectedDocument.id))
      setSelectedDocumentId((currentId) => (currentId === selectedDocument.id ? null : currentId))
    } catch (error) {
      setDocumentError(error instanceof Error ? error.message : 'Could not archive document')
    } finally {
      setIsArchivingDocument(false)
    }
  }

  async function handleCreateFolder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedWorkspace) {
      return
    }

    setFileError('')
    setIsCreatingFolder(true)

    try {
      await createFolder(selectedWorkspace.id, { name: newFolderName, parentFolderId: currentFolderId })
      setNewFolderName('')
      await loadDrive(selectedWorkspace.id, currentFolderId)
    } catch (error) {
      setFileError(error instanceof Error ? error.message : 'Could not create folder')
    } finally {
      setIsCreatingFolder(false)
    }
  }

  async function handleUploadFile(file: File, replacementFor?: DriveFile) {
    if (!selectedWorkspace) {
      return
    }

    setFileError('')
    setUploadProgress(0)
    setIsUploadingFile(true)

    try {
      const intent = replacementFor
        ? await createReplacementUploadIntent(selectedWorkspace.id, replacementFor.id, {
            mimeType: file.type || 'application/octet-stream',
            sizeBytes: file.size,
          })
        : await createFileUploadIntent(selectedWorkspace.id, {
            name: file.name,
            folderId: currentFolderId,
            mimeType: file.type || 'application/octet-stream',
            sizeBytes: file.size,
          })

      await uploadToSignedUrl(intent.uploadUrl, file, setUploadProgress)
      const completed = await completeFileUpload(selectedWorkspace.id, intent.file.id, intent.version.id)
      await loadDrive(selectedWorkspace.id, currentFolderId)
      setSelectedFileId(completed.file.id)
      await loadFileVersions(selectedWorkspace.id, completed.file.id)
    } catch (error) {
      setFileError(error instanceof Error ? error.message : 'Could not upload file')
    } finally {
      setIsUploadingFile(false)
      setUploadProgress(null)
    }
  }

  async function handleDownloadFile(file: DriveFile) {
    if (!selectedWorkspace) {
      return
    }

    setFileError('')

    try {
      const payload = await getFileDownload(selectedWorkspace.id, file.id)
      window.open(payload.downloadUrl, '_blank', 'noopener')
    } catch (error) {
      setFileError(error instanceof Error ? error.message : 'Could not download file')
    }
  }

  async function handleDownloadVersion(version: FileVersion) {
    if (!selectedWorkspace || !selectedFile) {
      return
    }

    setFileError('')

    try {
      const payload = await getFileVersionDownload(selectedWorkspace.id, selectedFile.id, version.id)
      window.open(payload.downloadUrl, '_blank', 'noopener')
    } catch (error) {
      setFileError(error instanceof Error ? error.message : 'Could not download version')
    }
  }

  async function handleRenameFolder(folder: Folder) {
    if (!selectedWorkspace) {
      return
    }

    const name = window.prompt('Folder name', folder.name)
    if (!name) {
      return
    }

    setFileError('')

    try {
      await renameFolder(selectedWorkspace.id, folder.id, name)
      await loadDrive(selectedWorkspace.id, currentFolderId)
    } catch (error) {
      setFileError(error instanceof Error ? error.message : 'Could not rename folder')
    }
  }

  async function handleArchiveFolder(folder: Folder) {
    if (!selectedWorkspace || !window.confirm(`Archive "${folder.name}" and everything inside it?`)) {
      return
    }

    setFileError('')

    try {
      await archiveFolder(selectedWorkspace.id, folder.id)
      await loadDrive(selectedWorkspace.id, currentFolderId)
    } catch (error) {
      setFileError(error instanceof Error ? error.message : 'Could not archive folder')
    }
  }

  async function handleRenameFile(file: DriveFile) {
    if (!selectedWorkspace) {
      return
    }

    const name = window.prompt('File name', file.name)
    if (!name) {
      return
    }

    setFileError('')

    try {
      const payload = await updateFile(selectedWorkspace.id, file.id, { name })
      setDriveFiles((current) => current.map((item) => (item.id === payload.file.id ? payload.file : item)))
    } catch (error) {
      setFileError(error instanceof Error ? error.message : 'Could not rename file')
    }
  }

  async function handleMoveFile(file: DriveFile, folderId: string | null) {
    if (!selectedWorkspace) {
      return
    }

    setFileError('')

    try {
      await updateFile(selectedWorkspace.id, file.id, { folderId })
      await loadDrive(selectedWorkspace.id, currentFolderId)
    } catch (error) {
      setFileError(error instanceof Error ? error.message : 'Could not move file')
    }
  }

  async function handleArchiveFile(file: DriveFile) {
    if (!selectedWorkspace || !window.confirm(`Archive "${file.name}"?`)) {
      return
    }

    setFileError('')

    try {
      await archiveFile(selectedWorkspace.id, file.id)
      await loadDrive(selectedWorkspace.id, currentFolderId)
    } catch (error) {
      setFileError(error instanceof Error ? error.message : 'Could not archive file')
    }
  }

  async function handleCreateInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedWorkspace) {
      return
    }

    setPeopleError('')
    setIsInviting(true)

    try {
      await createWorkspaceInvite(selectedWorkspace.id, { email: inviteEmail, role: inviteRole })
      setInviteEmail('')
      await Promise.all([loadPeople(selectedWorkspace.id), loadNotifications()])
    } catch (error) {
      setPeopleError(error instanceof Error ? error.message : 'Could not create invite')
    } finally {
      setIsInviting(false)
    }
  }

  async function handleAcceptInvite(invite: WorkspaceInvite) {
    setWorkspaceError('')

    try {
      const payload = await acceptInvite(invite.id)
      setWorkspaces((current) => {
        if (current.some((workspace) => workspace.id === payload.workspace.id)) {
          return current
        }

        return [payload.workspace, ...current]
      })
      setSelectedWorkspaceId(payload.workspace.id)
      await Promise.all([loadMyInvites(), loadNotifications()])
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : 'Could not accept invite')
    }
  }

  async function handleRevokeInvite(invite: WorkspaceInvite) {
    if (!selectedWorkspace) {
      return
    }

    setPeopleError('')

    try {
      await revokeWorkspaceInvite(selectedWorkspace.id, invite.id)
      await loadPeople(selectedWorkspace.id)
    } catch (error) {
      setPeopleError(error instanceof Error ? error.message : 'Could not revoke invite')
    }
  }

  async function handleShareDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedWorkspace || !selectedDocument) {
      return
    }

    setDocumentError('')

    try {
      await shareDocument(selectedWorkspace.id, selectedDocument.id, {
        email: documentShareEmail,
        level: documentShareLevel,
      })
      setDocumentShareEmail('')
      await Promise.all([loadDocumentGrants(selectedWorkspace.id, selectedDocument.id), loadNotifications()])
    } catch (error) {
      setDocumentError(error instanceof Error ? error.message : 'Could not share document')
    }
  }

  async function handleRevokeDocumentGrant(grant: ResourceGrant) {
    if (!selectedWorkspace || !selectedDocument) {
      return
    }

    setDocumentError('')

    try {
      await revokeDocumentPermission(selectedWorkspace.id, selectedDocument.id, grant.id)
      await loadDocumentGrants(selectedWorkspace.id, selectedDocument.id)
    } catch (error) {
      setDocumentError(error instanceof Error ? error.message : 'Could not revoke access')
    }
  }

  async function handleShareFile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedWorkspace || !selectedFile) {
      return
    }

    setFileError('')

    try {
      await shareFile(selectedWorkspace.id, selectedFile.id, {
        email: fileShareEmail,
        level: fileShareLevel,
      })
      setFileShareEmail('')
      await Promise.all([loadFileGrants(selectedWorkspace.id, selectedFile.id), loadNotifications()])
    } catch (error) {
      setFileError(error instanceof Error ? error.message : 'Could not share file')
    }
  }

  async function handleRevokeFileGrant(grant: ResourceGrant) {
    if (!selectedWorkspace || !selectedFile) {
      return
    }

    setFileError('')

    try {
      await revokeFilePermission(selectedWorkspace.id, selectedFile.id, grant.id)
      await loadFileGrants(selectedWorkspace.id, selectedFile.id)
    } catch (error) {
      setFileError(error instanceof Error ? error.message : 'Could not revoke access')
    }
  }

  async function handleMarkNotificationRead(notification: Notification) {
    try {
      await markNotificationRead(notification.id)
      await loadNotifications()
    } catch {
      // The notification panel is non-critical; the next refresh will reconcile state.
    }
  }

  async function handleMarkAllNotificationsRead() {
    try {
      await markAllNotificationsRead()
      await loadNotifications()
    } catch {
      // The notification panel is non-critical; the next refresh will reconcile state.
    }
  }

  async function handleCreateChannel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedWorkspace) {
      return
    }

    setChatError('')
    setIsCreatingChannel(true)

    try {
      const payload = await createChatChannel(selectedWorkspace.id, newChannelName)
      setChatChannels((current) => [payload.channel, ...current])
      setSelectedChannelId(payload.channel.id)
      setNewChannelName('')
      if (appView === 'activity') {
        await loadActivity(selectedWorkspace.id)
      }
    } catch (error) {
      setChatError(error instanceof Error ? error.message : 'Could not create channel')
    } finally {
      setIsCreatingChannel(false)
    }
  }

  function handleChatDraft(value: string) {
    setChatDraft(value)

    if (!selectedWorkspace || !selectedChannel) {
      return
    }

    sendRealtime({
      type: 'chat.typing',
      workspaceId: selectedWorkspace.id,
      channelId: selectedChannel.id,
      isTyping: Boolean(value.trim()),
    })

    if (typingTimerRef.current) {
      window.clearTimeout(typingTimerRef.current)
    }

    typingTimerRef.current = window.setTimeout(() => {
      sendRealtime({
        type: 'chat.typing',
        workspaceId: selectedWorkspace.id,
        channelId: selectedChannel.id,
        isTyping: false,
      })
    }, 1500)
  }

  function handleSendChatMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedWorkspace || !selectedChannel || !chatDraft.trim()) {
      return
    }

    const body = chatDraft.trim()
    const clientMessageId =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`

    setChatError('')
    setChatDraft('')
    sendRealtime({
      type: 'chat.message.send',
      workspaceId: selectedWorkspace.id,
      channelId: selectedChannel.id,
      clientMessageId,
      body,
    })
    sendRealtime({
      type: 'chat.typing',
      workspaceId: selectedWorkspace.id,
      channelId: selectedChannel.id,
      isTyping: false,
    })
  }

  if (session.isPending) {
    return (
      <main className="shell center">
        <p className="muted">Loading WorkspaceOS...</p>
      </main>
    )
  }

  if (!session.data?.user) {
    return <AuthScreen onAuthenticated={() => session.refetch()} />
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">WorkspaceOS</p>
          <h1>{selectedWorkspace?.name ?? 'Create your first workspace'}</h1>
        </div>
        <div className="user-menu">
          <div className="notification-wrap">
            <button
              type="button"
              className="secondary notification-button"
              onClick={() => setShowNotifications((current) => !current)}
            >
              Notifications {unreadCount ? `(${unreadCount})` : ''}
            </button>
            {showNotifications ? (
              <div className="notification-panel">
                <div className="panel-heading">
                  <h3>Notifications</h3>
                  <button type="button" className="secondary compact" onClick={handleMarkAllNotificationsRead}>
                    Mark all read
                  </button>
                </div>
                <div className="notification-list">
                  {notifications.length ? (
                    notifications.map((notification) => (
                      <button
                        type="button"
                        className={notification.readAt ? 'notification-item' : 'notification-item unread'}
                        key={notification.id}
                        onClick={() => handleMarkNotificationRead(notification)}
                      >
                        <strong>{notification.title}</strong>
                        <span>{notification.body}</span>
                        <small>{new Date(notification.createdAt).toLocaleString()}</small>
                      </button>
                    ))
                  ) : (
                    <p className="muted">No notifications yet.</p>
                  )}
                </div>
              </div>
            ) : null}
          </div>
          <span>{session.data.user.email}</span>
          <button
            type="button"
            className="secondary"
            onClick={async () => {
              await signOut()
              await session.refetch()
            }}
          >
            Log out
          </button>
        </div>
      </header>

      <section className="workspace-layout">
        <aside className="sidebar">
          <div className="section-header">
            <h2>Workspaces</h2>
          </div>

          <div className="workspace-list">
            {workspaces.map((workspace) => (
              <button
                type="button"
                className={workspace.id === selectedWorkspace?.id ? 'workspace-item active' : 'workspace-item'}
                key={workspace.id}
                onClick={() => setSelectedWorkspaceId(workspace.id)}
              >
                <span>{workspace.name}</span>
                <small>{workspace.role}</small>
              </button>
            ))}
          </div>

          {myInvites.length ? (
            <div className="invite-box">
              <h3>Invites</h3>
              {myInvites.map((invite) => (
                <div className="invite-row" key={invite.id}>
                  <div>
                    <strong>{invite.workspaceName ?? 'Workspace'}</strong>
                    <small>{invite.role}</small>
                  </div>
                  <button type="button" className="secondary compact" onClick={() => handleAcceptInvite(invite)}>
                    Accept
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          <form className="create-form" onSubmit={handleCreateWorkspace}>
            <label htmlFor="workspace-name">New workspace</label>
            <input
              id="workspace-name"
              value={workspaceName}
              onChange={(event) => setWorkspaceName(event.target.value)}
              placeholder="Design team"
              minLength={2}
              maxLength={80}
              required
            />
            <button type="submit" disabled={isCreatingWorkspace}>
              {isCreatingWorkspace ? 'Creating...' : 'Create'}
            </button>
            {workspaceError ? <p className="error">{workspaceError}</p> : null}
          </form>
        </aside>

        <section className="workspace-main">
          {selectedWorkspace ? (
            <>
              <div className="view-tabs" aria-label="Workspace sections">
                <button type="button" className={appView === 'documents' ? 'active' : ''} onClick={() => setAppView('documents')}>
                  Documents
                </button>
                <button type="button" className={appView === 'files' ? 'active' : ''} onClick={() => setAppView('files')}>
                  Files
                </button>
                <button type="button" className={appView === 'chat' ? 'active' : ''} onClick={() => setAppView('chat')}>
                  Chat
                </button>
                <button type="button" className={appView === 'activity' ? 'active' : ''} onClick={() => setAppView('activity')}>
                  Activity
                </button>
                <button type="button" className={appView === 'people' ? 'active' : ''} onClick={() => setAppView('people')}>
                  People
                </button>
              </div>

              {appView === 'documents' ? (
                <div className="documents-view">
                  <div className="documents-header">
                    <div>
                      <p className="eyebrow">{selectedWorkspace.role}</p>
                      <h2>Documents</h2>
                    </div>
                    <button type="button" onClick={handleCreateDocument} disabled={!canEditResources || isCreatingDocument}>
                      {isCreatingDocument ? 'Creating...' : 'New document'}
                    </button>
                  </div>

                  {documentError ? <p className="error">{documentError}</p> : null}

                  <div className="documents-grid">
                    <aside className="document-list" aria-label="Documents">
                      {documents.length ? (
                        documents.map((document) => (
                          <button
                            type="button"
                            className={document.id === selectedDocument?.id ? 'document-item active' : 'document-item'}
                            key={document.id}
                            onClick={() => setSelectedDocumentId(document.id)}
                          >
                            <span>{document.title}</span>
                            <small>
                              {document.sharedWithMe ? 'Shared with me · ' : ''}
                              {document.effectivePermission} · {new Date(document.updatedAt).toLocaleDateString()}
                            </small>
                          </button>
                        ))
                      ) : (
                        <p className="muted">No documents yet.</p>
                      )}
                    </aside>

                    <section className="editor-pane">
                      {selectedDocument ? (
                        <>
                          <input
                            className="title-input"
                            value={documentTitle}
                            onChange={(event) => {
                              setDocumentTitle(event.target.value)
                              setSaveStatus('dirty')
                            }}
                            disabled={!canEditSelectedDocument || isRealtimeRoomLoading}
                            aria-label="Document title"
                          />
                          <textarea
                            value={documentContent}
                            onChange={(event) => {
                              replaceYText(event.target.value)
                            }}
                            disabled={!canEditSelectedDocument || isRealtimeRoomLoading}
                            aria-label="Document content"
                            placeholder="Start writing..."
                          />
                          <div className="editor-actions">
                            <span className="save-status">{saveStatus}</span>
                            <span className={`realtime-status ${realtimeStatus}`}>{realtimeStatus}</span>
                            {collaborators.length ? (
                              <div className="collaborators" aria-label="Active collaborators">
                                {collaborators.map((collaborator) => (
                                  <span title={collaborator.email} key={collaborator.userId}>
                                    {collaborator.name.slice(0, 1).toUpperCase()}
                                  </span>
                                ))}
                              </div>
                            ) : null}
                            <button
                              type="button"
                              className="secondary"
                              onClick={handleArchiveDocument}
                              disabled={!canShareSelectedDocument || isArchivingDocument}
                            >
                              {isArchivingDocument ? 'Archiving...' : 'Archive'}
                            </button>
                            <button
                              type="button"
                              onClick={handleSaveDocument}
                              disabled={!canEditSelectedDocument || isRealtimeRoomLoading || saveStatus === 'saving' || saveStatus === 'saved'}
                            >
                              {saveStatus === 'saving' ? 'Saving...' : 'Save'}
                            </button>
                          </div>

                          {canShareSelectedDocument ? (
                            <div className="share-panel">
                              <div className="panel-heading">
                                <h3>Share document</h3>
                              </div>
                              <form className="share-form" onSubmit={handleShareDocument}>
                                <input
                                  type="email"
                                  value={documentShareEmail}
                                  onChange={(event) => setDocumentShareEmail(event.target.value)}
                                  placeholder="member@example.com"
                                  required
                                />
                                <select
                                  value={documentShareLevel}
                                  onChange={(event) => setDocumentShareLevel(event.target.value as ResourcePermissionLevel)}
                                >
                                  <option value="view">View</option>
                                  <option value="edit">Edit</option>
                                  <option value="owner">Owner</option>
                                </select>
                                <button type="submit">Share</button>
                              </form>
                              <div className="grant-list">
                                {documentGrants.map((grant) => (
                                  <div className="grant-row" key={grant.id}>
                                    <div>
                                      <strong>{grant.userName}</strong>
                                      <small>
                                        {grant.userEmail} · {grant.level}
                                      </small>
                                    </div>
                                    <button type="button" className="secondary compact" onClick={() => handleRevokeDocumentGrant(grant)}>
                                      Revoke
                                    </button>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : null}

                          <div className="version-panel">
                            <div className="section-header">
                              <h3>Version history</h3>
                            </div>
                            <div className="version-layout">
                              <div className="version-list">
                                {documentVersions.map((version) => (
                                  <button
                                    type="button"
                                    className={version.id === selectedDocumentVersion?.id ? 'version-item active' : 'version-item'}
                                    key={version.id}
                                    onClick={() => setSelectedDocumentVersionId(version.id)}
                                  >
                                    <span>Version {version.versionNumber}</span>
                                    <small>{new Date(version.createdAt).toLocaleString()}</small>
                                  </button>
                                ))}
                              </div>
                              <pre className="version-preview">
                                {selectedDocumentVersion
                                  ? `${selectedDocumentVersion.title}\n\n${selectedDocumentVersion.content || '(empty document)'}`
                                  : 'No versions yet.'}
                              </pre>
                            </div>
                          </div>
                        </>
                      ) : (
                        <div className="empty-editor">
                          <h3>Create the first document</h3>
                          <p className="muted">Documents are saved inside this workspace with version history.</p>
                        </div>
                      )}
                    </section>
                  </div>
                </div>
              ) : appView === 'files' ? (
                <div className="files-view">
                  <div className="documents-header">
                    <div>
                      <p className="eyebrow">{selectedWorkspace.role}</p>
                      <h2>Files</h2>
                    </div>
                    <label className="upload-button">
                      <span>{isUploadingFile ? 'Uploading...' : 'Upload file'}</span>
                      <input
                        type="file"
                        disabled={!canEditResources || isUploadingFile}
                        onChange={(event) => {
                          const file = event.target.files?.[0]
                          event.currentTarget.value = ''
                          if (file) {
                            void handleUploadFile(file)
                          }
                        }}
                      />
                    </label>
                  </div>

                  {fileError ? <p className="error">{fileError}</p> : null}
                  {uploadProgress !== null ? (
                    <div className="upload-progress">
                      <span style={{ width: `${uploadProgress}%` }} />
                    </div>
                  ) : null}

                  <nav className="breadcrumbs" aria-label="Folder path">
                    {folderStack.map((crumb, index) => (
                      <button
                        type="button"
                        className={index === folderStack.length - 1 ? 'active' : ''}
                        key={crumb.id ?? 'root'}
                        onClick={() => {
                          setFolderStack(folderStack.slice(0, index + 1))
                          setSelectedFileId(null)
                        }}
                      >
                        {crumb.name}
                      </button>
                    ))}
                  </nav>

                  <div className="files-grid">
                    <section className="file-browser">
                      <form className="inline-form" onSubmit={handleCreateFolder}>
                        <input
                          value={newFolderName}
                          onChange={(event) => setNewFolderName(event.target.value)}
                          placeholder="New folder"
                          maxLength={120}
                          required
                          disabled={!canEditResources}
                        />
                        <button type="submit" disabled={!canEditResources || isCreatingFolder}>
                          {isCreatingFolder ? 'Creating...' : 'Create folder'}
                        </button>
                      </form>

                      <div className="item-list">
                        {driveFolders.map((folder) => (
                          <div className="drive-item" key={folder.id}>
                            <button
                              type="button"
                              className="item-main"
                              onClick={() => {
                                setFolderStack((current) => [...current, { id: folder.id, name: folder.name }])
                                setSelectedFileId(null)
                              }}
                            >
                              <span className="item-icon">DIR</span>
                              <span>{folder.name}</span>
                            </button>
                            <div className="item-actions">
                              {selectedFile && selectedFile.folderId !== folder.id ? (
                                <button
                                  type="button"
                                  className="secondary compact"
                                  disabled={!canEditSelectedFile}
                                  onClick={() => handleMoveFile(selectedFile, folder.id)}
                                >
                                  Move selected here
                                </button>
                              ) : null}
                              <button type="button" className="secondary compact" disabled={!canEditResources} onClick={() => handleRenameFolder(folder)}>
                                Rename
                              </button>
                              <button type="button" className="secondary compact" disabled={!canEditResources} onClick={() => handleArchiveFolder(folder)}>
                                Archive
                              </button>
                            </div>
                          </div>
                        ))}

                        {driveFiles.map((file) => (
                          <div className={file.id === selectedFile?.id ? 'drive-item active' : 'drive-item'} key={file.id}>
                            <button type="button" className="item-main" onClick={() => setSelectedFileId(file.id)}>
                              <span className="item-icon">FILE</span>
                              <span>{file.name}</span>
                              <small>
                                {file.sharedWithMe ? 'Shared with me · ' : ''}
                                {file.effectivePermission} · v{file.latestVersionNumber} · {formatBytes(file.sizeBytes)}
                              </small>
                            </button>
                            <div className="item-actions">
                              <button type="button" className="secondary compact" onClick={() => handleDownloadFile(file)}>
                                Download
                              </button>
                              <button
                                type="button"
                                className="secondary compact"
                                disabled={!canEditPermission(file.effectivePermission)}
                                onClick={() => handleRenameFile(file)}
                              >
                                Rename
                              </button>
                              {file.folderId ? (
                                <button
                                  type="button"
                                  className="secondary compact"
                                  disabled={!canEditPermission(file.effectivePermission)}
                                  onClick={() => handleMoveFile(file, null)}
                                >
                                  Move to root
                                </button>
                              ) : null}
                              <button
                                type="button"
                                className="secondary compact"
                                disabled={!canSharePermission(file.effectivePermission)}
                                onClick={() => handleArchiveFile(file)}
                              >
                                Archive
                              </button>
                            </div>
                          </div>
                        ))}

                        {!driveFolders.length && !driveFiles.length ? (
                          <div className="empty-editor">
                            <h3>No files here</h3>
                            <p className="muted">Upload a file or create a folder to start building this workspace drive.</p>
                          </div>
                        ) : null}
                      </div>

                      {nextFileCursor !== null ? (
                        <button type="button" className="secondary" onClick={() => selectedWorkspace && loadDrive(selectedWorkspace.id, currentFolderId, nextFileCursor)}>
                          Load more files
                        </button>
                      ) : null}
                    </section>

                    <aside className="file-details">
                      {selectedFile ? (
                        <>
                          <div>
                            <p className="eyebrow">{selectedFile.uploadStatus}</p>
                            <h3>{selectedFile.name}</h3>
                            <p className="muted">
                              {selectedFile.mimeType} · {formatBytes(selectedFile.sizeBytes)}
                            </p>
                          </div>

                          <label className="upload-button secondary-upload">
                            <span>{isUploadingFile ? 'Uploading...' : 'Upload new version'}</span>
                            <input
                              type="file"
                              disabled={!canEditSelectedFile || isUploadingFile}
                              onChange={(event) => {
                                const file = event.target.files?.[0]
                                event.currentTarget.value = ''
                                if (file && selectedFile) {
                                  void handleUploadFile(file, selectedFile)
                                }
                              }}
                            />
                          </label>

                          {canShareSelectedFile ? (
                            <div className="share-panel">
                              <div className="panel-heading">
                                <h3>Share file</h3>
                              </div>
                              <form className="share-form" onSubmit={handleShareFile}>
                                <input
                                  type="email"
                                  value={fileShareEmail}
                                  onChange={(event) => setFileShareEmail(event.target.value)}
                                  placeholder="member@example.com"
                                  required
                                />
                                <select
                                  value={fileShareLevel}
                                  onChange={(event) => setFileShareLevel(event.target.value as ResourcePermissionLevel)}
                                >
                                  <option value="view">View</option>
                                  <option value="edit">Edit</option>
                                  <option value="owner">Owner</option>
                                </select>
                                <button type="submit">Share</button>
                              </form>
                              <div className="grant-list">
                                {fileGrants.map((grant) => (
                                  <div className="grant-row" key={grant.id}>
                                    <div>
                                      <strong>{grant.userName}</strong>
                                      <small>
                                        {grant.userEmail} · {grant.level}
                                      </small>
                                    </div>
                                    <button type="button" className="secondary compact" onClick={() => handleRevokeFileGrant(grant)}>
                                      Revoke
                                    </button>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : null}

                          <div className="version-list file-version-list">
                            {fileVersions.map((version) => (
                              <div className="version-row" key={version.id}>
                                <div>
                                  <strong>Version {version.versionNumber}</strong>
                                  <small>
                                    {version.uploadStatus} · {formatBytes(version.sizeBytes)} · {new Date(version.createdAt).toLocaleString()}
                                  </small>
                                </div>
                                {version.uploadStatus === 'uploaded' ? (
                                  <button type="button" className="secondary compact" onClick={() => handleDownloadVersion(version)}>
                                    Download
                                  </button>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        </>
                      ) : (
                        <p className="muted">Select a file to inspect versions and download historical objects.</p>
                      )}
                    </aside>
                  </div>
                </div>
              ) : appView === 'chat' ? (
                <div className="chat-view">
                  <div className="documents-header">
                    <div>
                      <p className="eyebrow">{realtimeStatus}</p>
                      <h2>Chat</h2>
                    </div>
                    <div className="presence-strip">
                      {onlineMembers.map((member) => (
                        <span title={member.email} key={member.userId}>
                          {member.name.slice(0, 1).toUpperCase()}
                        </span>
                      ))}
                    </div>
                  </div>

                  {chatError ? <p className="error">{chatError}</p> : null}

                  <div className="chat-grid">
                    <aside className="chat-sidebar">
                      <form className="inline-form" onSubmit={handleCreateChannel}>
                        <input
                          value={newChannelName}
                          onChange={(event) => setNewChannelName(event.target.value)}
                          placeholder="channel-name"
                          maxLength={60}
                          disabled={!canEditResources}
                          required
                        />
                        <button type="submit" disabled={!canEditResources || isCreatingChannel}>
                          {isCreatingChannel ? 'Creating...' : 'Create'}
                        </button>
                      </form>
                      <div className="channel-list">
                        {chatChannels.map((channel) => (
                          <button
                            type="button"
                            className={channel.id === selectedChannel?.id ? 'channel-item active' : 'channel-item'}
                            key={channel.id}
                            onClick={() => setSelectedChannelId(channel.id)}
                          >
                            #{channel.name}
                          </button>
                        ))}
                      </div>
                    </aside>

                    <section className="chat-panel">
                      {selectedChannel ? (
                        <>
                          <div className="panel-heading">
                            <h3>#{selectedChannel.name}</h3>
                            {nextMessageCursor ? (
                              <button
                                type="button"
                                className="secondary compact"
                                onClick={() => selectedWorkspace && loadChatMessages(selectedWorkspace.id, selectedChannel.id, nextMessageCursor)}
                              >
                                Load older
                              </button>
                            ) : null}
                          </div>
                          <div className="message-list">
                            {chatMessages.map((message) => (
                              <article className="message-row" key={message.id}>
                                <div>
                                  <strong>{message.senderName}</strong>
                                  <small>
                                    #{message.sequenceNumber} · {new Date(message.createdAt).toLocaleString()}
                                  </small>
                                </div>
                                <p>{message.body}</p>
                              </article>
                            ))}
                            {!chatMessages.length ? <p className="muted">No messages yet.</p> : null}
                          </div>
                          <p className="typing-line">
                            {typingMembers.length ? `${typingMembers.map((member) => member.name).join(', ')} typing...` : ''}
                          </p>
                          <form className="message-form" onSubmit={handleSendChatMessage}>
                            <input
                              value={chatDraft}
                              onChange={(event) => handleChatDraft(event.target.value)}
                              placeholder="Message the workspace. Mention people with @name or @email."
                              maxLength={4000}
                            />
                            <button type="submit" disabled={!chatDraft.trim()}>
                              Send
                            </button>
                          </form>
                        </>
                      ) : (
                        <p className="muted">Create or select a channel to start messaging.</p>
                      )}
                    </section>
                  </div>
                </div>
              ) : appView === 'activity' ? (
                <div className="activity-view">
                  <div className="documents-header">
                    <div>
                      <p className="eyebrow">Append-only feed</p>
                      <h2>Activity</h2>
                    </div>
                    <button type="button" className="secondary" onClick={() => selectedWorkspace && loadActivity(selectedWorkspace.id)}>
                      Refresh
                    </button>
                  </div>

                  {activityError ? <p className="error">{activityError}</p> : null}

                  <div className="activity-list">
                    {activityEvents.map((event) => (
                      <article className="activity-row" key={event.id}>
                        <div>
                          <strong>{event.summary}</strong>
                          <small>
                            {event.actorName ?? 'System'} · {event.eventType} · {new Date(event.createdAt).toLocaleString()}
                          </small>
                        </div>
                      </article>
                    ))}
                    {!activityEvents.length ? <p className="muted">No activity yet.</p> : null}
                  </div>

                  {nextActivityCursor ? (
                    <button type="button" className="secondary" onClick={() => selectedWorkspace && loadActivity(selectedWorkspace.id, nextActivityCursor)}>
                      Load older activity
                    </button>
                  ) : null}
                </div>
              ) : (
                <div className="people-view">
                  <div className="documents-header">
                    <div>
                      <p className="eyebrow">{selectedWorkspace.role}</p>
                      <h2>People</h2>
                    </div>
                  </div>

                  {peopleError ? <p className="error">{peopleError}</p> : null}

                  <div className="people-grid">
                    <section className="people-panel">
                      <div className="panel-heading">
                        <h3>Members</h3>
                      </div>
                      <div className="member-list">
                        {members.map((member) => (
                          <div className="member-row" key={member.id}>
                            <div>
                              <strong>{member.userName}</strong>
                              <small>{member.userEmail}</small>
                            </div>
                            <span>{member.role}</span>
                          </div>
                        ))}
                      </div>
                    </section>

                    <section className="people-panel">
                      <div className="panel-heading">
                        <h3>Invites</h3>
                      </div>
                      {canManagePeople ? (
                        <form className="share-form" onSubmit={handleCreateInvite}>
                          <input
                            type="email"
                            value={inviteEmail}
                            onChange={(event) => setInviteEmail(event.target.value)}
                            placeholder="teammate@example.com"
                            required
                          />
                          <select value={inviteRole} onChange={(event) => setInviteRole(event.target.value as WorkspaceRole)}>
                            <option value="viewer">Viewer</option>
                            <option value="member">Member</option>
                            <option value="admin">Admin</option>
                          </select>
                          <button type="submit" disabled={isInviting}>
                            {isInviting ? 'Inviting...' : 'Invite'}
                          </button>
                        </form>
                      ) : (
                        <p className="muted">Only workspace admins can invite people.</p>
                      )}

                      <div className="member-list">
                        {workspaceInvites.length ? (
                          workspaceInvites.map((invite) => (
                            <div className="member-row" key={invite.id}>
                              <div>
                                <strong>{invite.email}</strong>
                                <small>
                                  {invite.status} · {invite.role}
                                </small>
                              </div>
                              {invite.status === 'pending' && canManagePeople ? (
                                <button type="button" className="secondary compact" onClick={() => handleRevokeInvite(invite)}>
                                  Revoke
                                </button>
                              ) : null}
                            </div>
                          ))
                        ) : (
                          <p className="muted">No workspace invites yet.</p>
                        )}
                      </div>
                    </section>
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              <h2>No workspaces yet</h2>
              <p className="muted">Create a workspace to enter the protected app experience.</p>
            </>
          )}
        </section>
      </section>
    </main>
  )
}

function AuthScreen({ onAuthenticated }: { onAuthenticated: () => Promise<void> }) {
  const [mode, setMode] = useState<AuthMode>('signup')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setIsSubmitting(true)

    try {
      const result =
        mode === 'signup'
          ? await signUp.email({ name, email, password })
          : await signIn.email({ email, password })

      if (result.error) {
        setError(result.error.message ?? 'Authentication failed')
        return
      }

      await onAuthenticated()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Authentication failed')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-copy">
        <p className="eyebrow">WorkspaceOS</p>
        <h1>Collaboration starts with a real workspace.</h1>
        <p>
          Sign in to create your first workspace shell. The app now uses Better Auth for identity and
          keeps product permissions in our own database.
        </p>
      </section>

      <section className="auth-panel">
        <div className="mode-switch" aria-label="Authentication mode">
          <button type="button" className={mode === 'signup' ? 'active' : ''} onClick={() => setMode('signup')}>
            Sign up
          </button>
          <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>
            Log in
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          {mode === 'signup' ? (
            <label>
              Name
              <input value={name} onChange={(event) => setName(event.target.value)} minLength={2} required />
            </label>
          ) : null}

          <label>
            Email
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
          </label>

          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={8}
              required
            />
          </label>

          <button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Working...' : mode === 'signup' ? 'Create account' : 'Log in'}
          </button>
          {error ? <p className="error">{error}</p> : null}
        </form>
      </section>
    </main>
  )
}

export default App
