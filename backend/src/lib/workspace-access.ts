import { and, eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { resourcePermissions, workspaceMembers } from '../db/schema.js'

export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'viewer'
export type ResourceType = 'document' | 'file'
export type ResourcePermissionLevel = 'view' | 'edit' | 'owner'

const roleRank: Record<WorkspaceRole, number> = {
  viewer: 0,
  member: 1,
  admin: 2,
  owner: 3,
}

const permissionRank: Record<ResourcePermissionLevel, number> = {
  view: 0,
  edit: 1,
  owner: 2,
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

export function canManageWorkspace(role: WorkspaceRole) {
  return role === 'owner' || role === 'admin'
}

export function roleCanEditWorkspaceResources(role: WorkspaceRole) {
  return role === 'owner' || role === 'admin' || role === 'member'
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

export async function getResourceGrant(
  userId: string,
  workspaceId: string,
  resourceType: ResourceType,
  resourceId: string,
) {
  const [grant] = await db
    .select({
      id: resourcePermissions.id,
      workspaceId: resourcePermissions.workspaceId,
      resourceType: resourcePermissions.resourceType,
      resourceId: resourcePermissions.resourceId,
      userId: resourcePermissions.userId,
      level: resourcePermissions.level,
      grantedByUserId: resourcePermissions.grantedByUserId,
      createdAt: resourcePermissions.createdAt,
      updatedAt: resourcePermissions.updatedAt,
    })
    .from(resourcePermissions)
    .where(
      and(
        eq(resourcePermissions.userId, userId),
        eq(resourcePermissions.workspaceId, workspaceId),
        eq(resourcePermissions.resourceType, resourceType),
        eq(resourcePermissions.resourceId, resourceId),
      ),
    )
    .limit(1)

  return grant ?? null
}

export async function requireResourcePermission(
  userId: string,
  workspaceId: string,
  resourceType: ResourceType,
  resourceId: string,
  minimumLevel: ResourcePermissionLevel = 'view',
) {
  const membership = await getWorkspaceMembership(userId, workspaceId)

  if (!membership) {
    return { ok: false as const, status: 404, error: 'Workspace not found' }
  }

  if (membership.role === 'owner' || membership.role === 'admin') {
    return { ok: true as const, membership, level: 'owner' as const, grant: null }
  }

  const grant = await getResourceGrant(userId, workspaceId, resourceType, resourceId)

  if (minimumLevel !== 'owner' && membership.role === 'member') {
    return {
      ok: true as const,
      membership,
      level: grant?.level === 'owner' ? ('owner' as const) : ('edit' as const),
      grant,
    }
  }

  if (grant && permissionRank[grant.level] >= permissionRank[minimumLevel]) {
    return { ok: true as const, membership, level: grant.level, grant }
  }

  return { ok: false as const, status: 403, error: 'You do not have permission to access this resource.' }
}

export async function getEffectiveResourcePermission(
  userId: string,
  workspaceId: string,
  resourceType: ResourceType,
  resourceId: string,
) {
  const membership = await getWorkspaceMembership(userId, workspaceId)

  if (!membership) {
    return null
  }

  const grant = await getResourceGrant(userId, workspaceId, resourceType, resourceId)

  if (membership.role === 'owner' || membership.role === 'admin') {
    return { level: 'owner' as const, membership, grant, sharedWithMe: Boolean(grant && grant.level !== 'owner') }
  }

  if (membership.role === 'member') {
    if (grant?.level === 'owner') {
      return { level: 'owner' as const, membership, grant, sharedWithMe: false }
    }

    return { level: 'edit' as const, membership, grant, sharedWithMe: Boolean(grant) }
  }

  if (!grant) {
    return null
  }

  return { level: grant.level, membership, grant, sharedWithMe: true }
}

export function permissionAllowsEdit(level: ResourcePermissionLevel) {
  return permissionRank[level] >= permissionRank.edit
}
