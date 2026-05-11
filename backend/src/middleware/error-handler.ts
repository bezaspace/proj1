import type { NextFunction, Request, Response } from 'express'
import { incrementMetric } from '../lib/metrics.js'
import { logger } from '../lib/logger.js'

export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction) {
  const message = error instanceof Error ? error.message : 'Unknown error'
  const stack = error instanceof Error ? error.stack : undefined
  const statusCode = res.statusCode >= 400 ? res.statusCode : 500

  incrementMetric('http_errors_total', { method: req.method, route: req.route?.path ?? req.path, status: statusCode })
  logger.error('request_failed', {
    requestId: req.requestId,
    method: req.method,
    path: req.path,
    statusCode,
    error: message,
    stack,
  })

  res.status(statusCode).json({
    error: statusCode >= 500 ? 'Internal server error' : message,
    requestId: req.requestId,
  })
}
