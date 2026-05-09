import 'dotenv/config'

const requiredEnv = ['DATABASE_URL', 'BETTER_AUTH_SECRET'] as const

for (const key of requiredEnv) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`)
  }
}

export const env = {
  port: Number(process.env.PORT || 4000),
  databaseUrl: process.env.DATABASE_URL!,
  betterAuthSecret: process.env.BETTER_AUTH_SECRET!,
  betterAuthUrl: process.env.BETTER_AUTH_URL || 'http://localhost:4000',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
}
