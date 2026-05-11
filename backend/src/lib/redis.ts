import { createClient } from 'redis'
import { env } from '../env.js'

export const redis = createClient({ url: env.redisUrl })
export const redisPublisher = redis.duplicate()
export const redisSubscriber = redis.duplicate()

for (const client of [redis, redisPublisher, redisSubscriber]) {
  client.on('error', (error) => {
    console.error('Redis client error', error)
  })
}

export async function connectRedis() {
  await Promise.all([redis.connect(), redisPublisher.connect(), redisSubscriber.connect()])
}

export async function disconnectRedis() {
  await Promise.allSettled([redis.destroy(), redisPublisher.destroy(), redisSubscriber.destroy()])
}

