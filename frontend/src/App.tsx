import { FormEvent, useEffect, useMemo, useState } from 'react'
import {
  archiveDocument,
  archiveFile,
  archiveFolder,
  completeFileUpload,
  createDocument,
  createFileUploadIntent,
  createFolder,
  createReplacementUploadIntent,
  createWorkspace,
  getDocumentVersions,
  getDocuments,
  getDriveItems,
  getFileDownload,
  getFileVersionDownload,
  getFileVersions,
  getWorkspaces,
  renameFolder,
  updateDocument,
  updateFile,
  type Document,
  type DocumentVersion,
  type DriveFile,
  type FileVersion,
  type Folder,
  type Workspace,
} from './api'
import { signIn, signOut, signUp, useSession } from './auth-client'

type AuthMode = 'signup' | 'login'
type AppView = 'documents' | 'files'
type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved'
type FolderCrumb = { id: string | null; name: string }

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
  const currentFolderId = folderStack[folderStack.length - 1]?.id ?? null
  const canEditResources =
    selectedWorkspace?.role === 'owner' || selectedWorkspace?.role === 'admin' || selectedWorkspace?.role === 'member'

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

  useEffect(() => {
    if (!session.data?.user) {
      setWorkspaces([])
      setSelectedWorkspaceId(null)
      setDocuments([])
      setSelectedDocumentId(null)
      setDriveFolders([])
      setDriveFiles([])
      setSelectedFileId(null)
      return
    }

    loadWorkspaces().catch((error) => {
      setWorkspaceError(error instanceof Error ? error.message : 'Could not load workspaces')
    })
  }, [session.data?.user?.id])

  useEffect(() => {
    setFolderStack([{ id: null, name: 'Files' }])
    setDriveFolders([])
    setDriveFiles([])
    setSelectedFileId(null)
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
      setDocumentTitle('')
      setDocumentContent('')
      setDocumentVersions([])
      setSelectedDocumentVersionId(null)
      setSaveStatus('idle')
      return
    }

    setDocumentTitle(selectedDocument.title)
    setDocumentContent(selectedDocument.content)
    setSaveStatus('saved')
  }, [selectedDocument?.id])

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
    if (appView !== 'files' || !selectedWorkspace?.id || !selectedFile?.id) {
      setFileVersions([])
      return
    }

    loadFileVersions(selectedWorkspace.id, selectedFile.id).catch((error) => {
      setFileError(error instanceof Error ? error.message : 'Could not load file versions')
    })
  }, [appView, selectedWorkspace?.id, selectedFile?.id])

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
                            <small>{new Date(document.updatedAt).toLocaleDateString()}</small>
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
                            disabled={!canEditResources}
                            aria-label="Document title"
                          />
                          <textarea
                            value={documentContent}
                            onChange={(event) => {
                              setDocumentContent(event.target.value)
                              setSaveStatus('dirty')
                            }}
                            disabled={!canEditResources}
                            aria-label="Document content"
                            placeholder="Start writing..."
                          />
                          <div className="editor-actions">
                            <span className="save-status">{saveStatus}</span>
                            <button
                              type="button"
                              className="secondary"
                              onClick={handleArchiveDocument}
                              disabled={!canEditResources || isArchivingDocument}
                            >
                              {isArchivingDocument ? 'Archiving...' : 'Archive'}
                            </button>
                            <button
                              type="button"
                              onClick={handleSaveDocument}
                              disabled={!canEditResources || saveStatus === 'saving' || saveStatus === 'saved'}
                            >
                              {saveStatus === 'saving' ? 'Saving...' : 'Save'}
                            </button>
                          </div>

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
              ) : (
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
                                <button type="button" className="secondary compact" onClick={() => handleMoveFile(selectedFile, folder.id)}>
                                  Move selected here
                                </button>
                              ) : null}
                              <button type="button" className="secondary compact" onClick={() => handleRenameFolder(folder)}>
                                Rename
                              </button>
                              <button type="button" className="secondary compact" onClick={() => handleArchiveFolder(folder)}>
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
                                v{file.latestVersionNumber} · {formatBytes(file.sizeBytes)}
                              </small>
                            </button>
                            <div className="item-actions">
                              <button type="button" className="secondary compact" onClick={() => handleDownloadFile(file)}>
                                Download
                              </button>
                              <button type="button" className="secondary compact" onClick={() => handleRenameFile(file)}>
                                Rename
                              </button>
                              {file.folderId ? (
                                <button type="button" className="secondary compact" onClick={() => handleMoveFile(file, null)}>
                                  Move to root
                                </button>
                              ) : null}
                              <button type="button" className="secondary compact" onClick={() => handleArchiveFile(file)}>
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
                              disabled={!canEditResources || isUploadingFile}
                              onChange={(event) => {
                                const file = event.target.files?.[0]
                                event.currentTarget.value = ''
                                if (file && selectedFile) {
                                  void handleUploadFile(file, selectedFile)
                                }
                              }}
                            />
                          </label>

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
