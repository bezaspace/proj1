import type { NextFunction, Request, Response } from 'express'
import { redis } from './redis.js'
import { incrementMetric } from './metrics.js'

export type RateLimitRule = {
  keyPrefix: string
  limit: number
  windowSeconds: number
}

export async function checkRateLimit(identifier: string, rule: RateLimitRule) {
  const windowId = Math.floor(Date.now() / 1000 / rule.windowSeconds)
  const key = `rate:${rule.keyPrefix}:${identifier}:${windowId}`
  const count = await redis.incr(key)

  if (count === 1) {
    await redis.expire(key, rule.windowSeconds + 2)
  }

  const remaining = Math.max(0, rule.limit - count)
  const retryAfter = Math.max(1, (windowId + 1) * rule.windowSeconds - Math.floor(Date.now() / 1000))

  return {
    allowed: count <= rule.limit,
    count,
    limit: rule.limit,
    remaining,
    retryAfter,
  }
}

export function rateLimit(rule: RateLimitRule, identifier: (req: Request) => string = (req) => req.auth?.user.id ?? req.ip ?? 'unknown') {
  return async (req: Request, res: Response, next: NextFunction) => {
    const result = await checkRateLimit(identifier(req), rule)
    res.setHeader('X-RateLimit-Limit', String(result.limit))
    res.setHeader('X-RateLimit-Remaining', String(result.remaining))

    if (!result.allowed) {
      res.setHeader('Retry-After', String(result.retryAfter))
      incrementMetric('rate_limited_requests_total', { rule: rule.keyPrefix })
      res.status(429).json({ error: 'Too many requests. Slow down and retry shortly.' })
      return
    }

    next()
  }
}
