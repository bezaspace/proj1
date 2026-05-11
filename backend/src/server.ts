import express from 'express'
import cors from 'cors'
import { createServer } from 'node:http'
import { toNodeHandler } from 'better-auth/node'
import { auth } from './lib/auth.js'
import { env } from './env.js'
import { meRouter } from './routes/me.js'
import { workspacesRouter } from './routes/workspaces.js'
import { documentsRouter } from './routes/documents.js'
import { filesRouter } from './routes/files.js'
import { collaborationRouter } from './routes/collaboration.js'
import { notificationsRouter } from './routes/notifications.js'
import { chatRouter } from './routes/chat.js'
import { activityRouter } from './routes/activity.js'
import { metricsRouter } from './routes/metrics.js'
import { searchRouter } from './routes/search.js'
import { publicShareRouter, shareLinksRouter } from './routes/public-links.js'
import { ensureObjectStorageBucket } from './lib/object-storage.js'
import { connectRedis } from './lib/redis.js'
import { setupRealtimeServer } from './realtime.js'
import { requestMetrics } from './middleware/request-metrics.js'
import { errorHandler } from './middleware/error-handler.js'
import { startWorkerLoop } from './lib/jobs.js'
import { logger } from './lib/logger.js'

const app = express()

app.use(
  cors({
    origin: env.frontendUrl,
    credentials: true,
  }),
)
app.use(requestMetrics)

app.all('/api/auth/*', toNodeHandler(auth))

app.use(express.json())

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', service: 'backend' })
})

app.get('/ready', (_req, res) => {
  res.status(200).json({ status: 'ready', service: 'backend' })
})

app.get('/', (_req, res) => {
  res.json({ message: 'SynapseDrive backend is ready', health: '/health' })
})

app.use('/api', meRouter)
app.use('/api', workspacesRouter)
app.use('/api', documentsRouter)
app.use('/api', filesRouter)
app.use('/api', collaborationRouter)
app.use('/api', notificationsRouter)
app.use('/api', chatRouter)
app.use('/api', activityRouter)
app.use('/api', searchRouter)
app.use('/api', shareLinksRouter)
app.use('/api', publicShareRouter)
app.use(metricsRouter)
app.use(errorHandler)

const server = createServer(app)

Promise.all([ensureObjectStorageBucket(), connectRedis()])
  .then(() => setupRealtimeServer(server))
  .then(() => {
    startWorkerLoop()
    server.listen(env.port, () => {
      logger.info('backend_started', { url: `http://localhost:${env.port}` })
    })
  })
  .catch((error) => {
    logger.error('backend_start_failed', { error: error instanceof Error ? error.message : 'Unknown startup failure' })
    process.exit(1)
  })
