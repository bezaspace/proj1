import type { NextFunction, Request, Response } from 'express'
import { fromNodeHeaders } from 'better-auth/node'
import { auth } from '../lib/auth.js'

export type AuthSession = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>

declare global {
  namespace Express {
    interface Request {
      auth?: AuthSession
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(req.headers),
  })

  if (!session) {
    res.status(401).json({ error: 'Authentication required' })
    return
  }

  req.auth = session
  next()
}
