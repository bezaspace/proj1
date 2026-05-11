import { processDueJobs } from '../lib/jobs.js'
import { connectRedis, disconnectRedis } from '../lib/redis.js'
import { pool } from '../db/index.js'

async function main() {
  await connectRedis()
  console.log('WorkspaceOS worker started')

  let shouldStop = false
  process.on('SIGINT', () => {
    shouldStop = true
  })
  process.on('SIGTERM', () => {
    shouldStop = true
  })

  while (!shouldStop) {
    await processDueJobs(25)
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }

  await disconnectRedis()
  await pool.end()
}

main().catch(async (error) => {
  console.error('Worker crashed', error)
  await disconnectRedis()
  await pool.end()
  process.exit(1)
})
