import { redis } from './redis.js'
import { incrementMetric } from './metrics.js'

const defaultTtlSeconds = 60

export async function getCachedJson<T>(key: string): Promise<T | null> {
  const raw = await redis.get(key)

  if (!raw) {
    incrementMetric('cache_misses_total', { cache: key.split(':')[1] ?? 'unknown' })
    return null
  }

  incrementMetric('cache_hits_total', { cache: key.split(':')[1] ?? 'unknown' })
  return JSON.parse(raw) as T
}

export async function setCachedJson(key: string, value: unknown, ttlSeconds = defaultTtlSeconds) {
  await redis.set(key, JSON.stringify(value), { EX: ttlSeconds })
}

export async function deleteCacheKeys(keys: string[]) {
  if (!keys.length) {
    return 0
  }

  return redis.del(keys)
}

export async function deleteCachePattern(pattern: string) {
  const keys: string[] = []

  for await (const key of redis.scanIterator({ MATCH: pattern, COUNT: 100 })) {
    keys.push(String(key))
  }

  return deleteCacheKeys(keys)
}

export async function invalidateCachePatterns(patterns: string[]) {
  for (const pattern of patterns) {
    await deleteCachePattern(pattern)
  }
}

export const cacheKeys = {
  membership: (workspaceId: string, userId: string) => `cache:membership:${workspaceId}:${userId}`,
  resourceGrant: (workspaceId: string, resourceType: string, resourceId: string, userId: string) =>
    `cache:grant:${workspaceId}:${resourceType}:${resourceId}:${userId}`,
  fileMetadata: (workspaceId: string, fileId: string) => `cache:file:${workspaceId}:${fileId}`,
  workspaceMemberships: (workspaceId: string) => `cache:membership:${workspaceId}:*`,
  resourceGrants: (workspaceId: string, resourceType: string, resourceId: string) =>
    `cache:grant:${workspaceId}:${resourceType}:${resourceId}:*`,
}
