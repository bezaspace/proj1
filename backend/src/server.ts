import express from 'express'
import cors from 'cors'
import morgan from 'morgan'
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
import { ensureObjectStorageBucket } from './lib/object-storage.js'
import { connectRedis } from './lib/redis.js'
import { setupRealtimeServer } from './realtime.js'

const app = express()

app.use(
  cors({
    origin: env.frontendUrl,
    credentials: true,
  }),
)
app.use(morgan('dev'))

app.all('/api/auth/*', toNodeHandler(auth))

app.use(express.json())

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', service: 'backend' })
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

const server = createServer(app)

Promise.all([ensureObjectStorageBucket(), connectRedis()])
  .then(() => setupRealtimeServer(server))
  .then(() => {
    server.listen(env.port, () => {
      console.log(`Backend running at http://localhost:${env.port}`)
    })
  })
  .catch((error) => {
    console.error('Failed to initialize object storage', error)
    process.exit(1)
  })
