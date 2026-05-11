import * as Minio from 'minio'
import { env } from '../env.js'

export const objectStorage = new Minio.Client({
  endPoint: env.objectStorage.endpoint,
  port: env.objectStorage.port,
  useSSL: env.objectStorage.useSsl,
  accessKey: env.objectStorage.accessKey,
  secretKey: env.objectStorage.secretKey,
  region: env.objectStorage.region,
})

export async function ensureObjectStorageBucket() {
  const exists = await objectStorage.bucketExists(env.objectStorage.bucket)

  if (!exists) {
    await objectStorage.makeBucket(env.objectStorage.bucket, env.objectStorage.region)
  }
}

export function createUploadUrl(objectKey: string) {
  return objectStorage.presignedPutObject(env.objectStorage.bucket, objectKey, 15 * 60)
}

export function createDownloadUrl(objectKey: string, fileName: string) {
  return objectStorage.presignedGetObject(env.objectStorage.bucket, objectKey, 10 * 60, {
    'response-content-disposition': `attachment; filename="${fileName.replaceAll('"', '')}"`,
  })
}

export async function statStoredObject(objectKey: string) {
  return objectStorage.statObject(env.objectStorage.bucket, objectKey)
}
