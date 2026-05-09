import { betterAuth } from 'better-auth'
import { env } from '../env.js'
import { pool } from '../db/index.js'

export const auth = betterAuth({
  database: pool,
  secret: env.betterAuthSecret,
  baseURL: env.betterAuthUrl,
  trustedOrigins: [env.frontendUrl],
  emailAndPassword: {
    enabled: true,
  },
})
