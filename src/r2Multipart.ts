import {
  CreateMultipartUploadCommand,
  UploadPartCommand,
  ListPartsCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { config } from './config.js'
import { r2 } from './r2.js'
import { PART_URL_EXPIRES_SECONDS, type ListedPart } from './multipartLogic.js'

const Bucket = () => config.r2BucketName

export async function createUpload(key: string, contentType: string): Promise<string> {
  const out = await r2.send(new CreateMultipartUploadCommand({ Bucket: Bucket(), Key: key, ContentType: contentType }))
  if (!out.UploadId) throw new Error('R2 no devolvió UploadId')
  return out.UploadId
}

export function signPart(key: string, uploadId: string, partNumber: number): Promise<string> {
  const command = new UploadPartCommand({ Bucket: Bucket(), Key: key, UploadId: uploadId, PartNumber: partNumber })
  return getSignedUrl(r2, command, { expiresIn: PART_URL_EXPIRES_SECONDS })
}

export async function listParts(key: string, uploadId: string): Promise<ListedPart[]> {
  const parts: ListedPart[] = []
  let marker: string | undefined
  for (;;) {
    const out = await r2.send(
      new ListPartsCommand({ Bucket: Bucket(), Key: key, UploadId: uploadId, PartNumberMarker: marker }),
    )
    for (const p of out.Parts ?? []) {
      if (p.PartNumber != null && p.ETag) {
        parts.push({ partNumber: p.PartNumber, size: p.Size ?? 0, etag: p.ETag })
      }
    }
    if (!out.IsTruncated || !out.NextPartNumberMarker) break
    marker = out.NextPartNumberMarker
  }
  return parts
}

export async function completeUpload(
  key: string,
  uploadId: string,
  parts: { partNumber: number; etag: string }[],
): Promise<void> {
  await r2.send(
    new CompleteMultipartUploadCommand({
      Bucket: Bucket(),
      Key: key,
      UploadId: uploadId,
      MultipartUpload: { Parts: parts.map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })) },
    }),
  )
}

export async function abortUpload(key: string, uploadId: string): Promise<void> {
  await r2.send(new AbortMultipartUploadCommand({ Bucket: Bucket(), Key: key, UploadId: uploadId }))
}
