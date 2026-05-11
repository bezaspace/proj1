import 'dotenv/config'

const requiredEnv = ['DATABASE_URL', 'BETTER_AUTH_SECRET', 'OBJECT_STORAGE_ACCESS_KEY', 'OBJECT_STORAGE_SECRET_KEY'] as const

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
  objectStorage: {
    endpoint: process.env.OBJECT_STORAGE_ENDPOINT || 'localhost',
    port: Number(process.env.OBJECT_STORAGE_PORT || 9010),
    useSsl: process.env.OBJECT_STORAGE_USE_SSL === 'true',
    accessKey: process.env.OBJECT_STORAGE_ACCESS_KEY!,
    secretKey: process.env.OBJECT_STORAGE_SECRET_KEY!,
    bucket: process.env.OBJECT_STORAGE_BUCKET || 'workspaceos-files',
    region: process.env.OBJECT_STORAGE_REGION || 'us-east-1',
  },
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES || 52_428_800),
}
