import type { NextFunction, Request, Response } from 'express'
import { randomUUID } from 'node:crypto'
import { incrementMetric, observeMetric } from '../lib/metrics.js'
import { logger } from '../lib/logger.js'

declare global {
  namespace Express {
    interface Request {
      requestId?: string
    }
  }
}

export function requestMetrics(req: Request, res: Response, next: NextFunction) {
  const startedAt = process.hrtime.bigint()
  const requestId = req.headers['x-request-id']
  req.requestId = typeof requestId === 'string' && requestId.length <= 120 ? requestId : randomUUID()
  res.setHeader('X-Request-Id', req.requestId)

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000
    const route = req.route?.path ? String(req.route.path) : req.path

    incrementMetric('http_requests_total', { method: req.method, route, status: res.statusCode })
    observeMetric('http_request_duration_ms', durationMs, { method: req.method, route })
    logger.info('request_completed', {
      requestId: req.requestId,
      method: req.method,
      path: req.path,
      route,
      statusCode: res.statusCode,
      durationMs: Math.round(durationMs * 100) / 100,
      contentLength: res.getHeader('content-length') ?? null,
    })
  })

  next()
}
