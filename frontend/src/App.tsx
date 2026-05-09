import { FormEvent, useEffect, useMemo, useState } from 'react'
import { createWorkspace, getWorkspaces, type Workspace } from './api'
import { signIn, signOut, signUp, useSession } from './auth-client'

type AuthMode = 'signup' | 'login'

function App() {
  const session = useSession()
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null)
  const [workspaceName, setWorkspaceName] = useState('')
  const [workspaceError, setWorkspaceError] = useState('')
  const [isCreatingWorkspace, setIsCreatingWorkspace] = useState(false)

  const selectedWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? workspaces[0],
    [selectedWorkspaceId, workspaces],
  )

  async function loadWorkspaces() {
    const payload = await getWorkspaces()
    setWorkspaces(payload.workspaces)
    setSelectedWorkspaceId((currentId) => currentId ?? payload.workspaces[0]?.id ?? null)
  }

  useEffect(() => {
    if (!session.data?.user) {
      setWorkspaces([])
      setSelectedWorkspaceId(null)
      return
    }

    loadWorkspaces().catch((error) => {
      setWorkspaceError(error instanceof Error ? error.message : 'Could not load workspaces')
    })
  }, [session.data?.user?.id])

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
              <p className="eyebrow">{selectedWorkspace.role}</p>
              <h2>{selectedWorkspace.name}</h2>
              <p className="muted">
                Authentication and workspace membership are wired. Documents, files, sharing, realtime
                collaboration, chat, and notifications can now build on this shell.
              </p>
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
