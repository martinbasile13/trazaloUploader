import { createReadStream, createWriteStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import type { Readable } from 'node:stream'
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectsCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { config } from './config.js'

export const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${config.r2AccountId}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: config.r2AccessKeyId,
    secretAccessKey: config.r2SecretAccessKey,
  },
})

const PRESIGN_EXPIRES_SECONDS = 300

export async function presignPut(key: string, contentType: string): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: config.r2BucketName,
    Key: key,
    ContentType: contentType,
  })
  return getSignedUrl(r2, command, { expiresIn: PRESIGN_EXPIRES_SECONDS })
}

export function publicUrlFor(key: string): string {
  return `${config.r2PublicBaseUrl}/${key}`
}

export async function deleteObjects(keys: (string | null | undefined)[]): Promise<void> {
  const validKeys = keys.filter((k): k is string => Boolean(k))
  if (validKeys.length === 0) return

  await r2.send(
    new DeleteObjectsCommand({
      Bucket: config.r2BucketName,
      Delete: { Objects: validKeys.map((Key) => ({ Key })) },
    }),
  )
}

export async function downloadToFile(key: string, destPath: string): Promise<void> {
  const result = await r2.send(new GetObjectCommand({ Bucket: config.r2BucketName, Key: key }))
  if (!result.Body) throw new Error(`Objeto vacío en R2: ${key}`)
  await pipeline(result.Body as Readable, createWriteStream(destPath))
}

export interface R2HealthResult {
  ok: boolean
  latency_ms: number
  error?: string
}

// HeadBucket es la operación más barata para confirmar que las credenciales
// y el endpoint responden: no lista ni transfiere objetos, solo confirma que
// el bucket existe y es alcanzable.
export async function checkR2Health(): Promise<R2HealthResult> {
  const start = Date.now()
  try {
    await r2.send(new HeadBucketCommand({ Bucket: config.r2BucketName }))
    return { ok: true, latency_ms: Date.now() - start }
  } catch (err) {
    return {
      ok: false,
      latency_ms: Date.now() - start,
      error: err instanceof Error ? err.message : 'Error desconocido',
    }
  }
}

export async function uploadFile(key: string, filePath: string, contentType: string): Promise<void> {
  const { size } = await stat(filePath)
  await r2.send(
    new PutObjectCommand({
      Bucket: config.r2BucketName,
      Key: key,
      Body: createReadStream(filePath),
      ContentType: contentType,
      ContentLength: size,
    }),
  )
}
