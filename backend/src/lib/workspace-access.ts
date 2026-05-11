import { and, eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { workspaceMembers } from '../db/schema.js'

export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'viewer'

const roleRank: Record<WorkspaceRole, number> = {
  viewer: 0,
  member: 1,
  admin: 2,
  owner: 3,
}

export async function getWorkspaceMembership(userId: string, workspaceId: string) {
  const [membership] = await db
    .select({
      id: workspaceMembers.id,
      workspaceId: workspaceMembers.workspaceId,
      userId: workspaceMembers.userId,
      role: workspaceMembers.role,
    })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.userId, userId), eq(workspaceMembers.workspaceId, workspaceId)))
    .limit(1)

  return membership ?? null
}

export async function requireWorkspaceRole(userId: string, workspaceId: string, minimumRole: WorkspaceRole = 'viewer') {
  const membership = await getWorkspaceMembership(userId, workspaceId)

  if (!membership) {
    return { ok: false as const, status: 404, error: 'Workspace not found' }
  }

  if (roleRank[membership.role] < roleRank[minimumRole]) {
    return { ok: false as const, status: 403, error: 'You do not have permission to perform this action.' }
  }

  return { ok: true as const, membership }
}
