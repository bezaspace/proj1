export type Workspace = {
  id: string
  name: string
  role: 'owner' | 'admin' | 'member' | 'viewer'
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

  const payload = (await response.json().catch(() => null)) as T | { error?: string } | null

  if (!response.ok) {
    const message = payload && 'error' in payload && payload.error ? payload.error : 'Request failed'
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
