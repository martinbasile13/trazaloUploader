import type { Request } from 'express'
import { HttpError } from './errors.js'
import { buildKey } from './keys.js'
import {
  PART_SIZE_BYTES,
  MAX_FILE_BYTES,
  computeTotalParts,
  parseCreate,
  parseUploadRef,
  parsePartNumbers,
  parseTotalParts,
  findMissingParts,
  type ListedPart,
} from './multipartLogic.js'

// Los handlers reciben sus dependencias (auth + S3) por parámetro para poder
// testearlos con mocks sin variables de entorno ni red.
export interface MultipartDeps {
  requireUser: (req: Request) => Promise<string>
  assertOwnsProject: (userId: string, businessId: string, projectId: string) => Promise<void>
  publicUrlFor: (key: string) => string
  createUpload: (key: string, contentType: string) => Promise<string>
  signPart: (key: string, uploadId: string, partNumber: number) => Promise<string>
  listParts: (key: string, uploadId: string) => Promise<ListedPart[]>
  completeUpload: (key: string, uploadId: string, parts: { partNumber: number; etag: string }[]) => Promise<void>
  abortUpload: (key: string, uploadId: string) => Promise<void>
}

export interface HandlerResult {
  status: number
  body: unknown
}

export const capabilities = (): HandlerResult => ({
  status: 200,
  body: { multipart: true, partSizeBytes: PART_SIZE_BYTES, maxFileBytes: MAX_FILE_BYTES },
})

// R2/S3 responde NoSuchUpload cuando el uploadId no existe, expiró o ya se completó/abortó.
function isNoSuchUpload(err: unknown): boolean {
  const e = err as { name?: string; Code?: string } | null
  return e?.name === 'NoSuchUpload' || e?.Code === 'NoSuchUpload'
}

const gone = () => new HttpError(404, 'La subida no existe o ya expiró')

export function createHandlers(deps: MultipartDeps) {
  async function auth(req: Request, businessId: string, projectId: string) {
    const userId = await deps.requireUser(req)
    await deps.assertOwnsProject(userId, businessId, projectId)
  }

  return {
    async create(req: Request): Promise<HandlerResult> {
      const input = parseCreate(req.body)
      await auth(req, input.businessId, input.projectId)

      const key = buildKey(input.businessId, input.projectId, input.updateId, input.kind, input.ext)
      const uploadId = await deps.createUpload(key, input.contentType)
      return {
        status: 200,
        body: {
          uploadId,
          storagePath: key,
          publicUrl: input.kind === 'video-raw' ? null : deps.publicUrlFor(key),
          partSizeBytes: PART_SIZE_BYTES,
          totalParts: computeTotalParts(input.sizeBytes),
        },
      }
    },

    async partUrls(req: Request): Promise<HandlerResult> {
      const ref = parseUploadRef(req.body)
      const partNumbers = parsePartNumbers(ref.body)
      await auth(req, ref.businessId, ref.projectId)

      const urls = await Promise.all(
        partNumbers.map(async (partNumber) => ({
          partNumber,
          url: await deps.signPart(ref.storagePath, ref.uploadId, partNumber),
        })),
      )
      return { status: 200, body: { urls } }
    },

    async listParts(req: Request): Promise<HandlerResult> {
      const ref = parseUploadRef(req.body)
      await auth(req, ref.businessId, ref.projectId)
      try {
        const parts = await deps.listParts(ref.storagePath, ref.uploadId)
        return { status: 200, body: { parts: parts.map((p) => ({ partNumber: p.partNumber, size: p.size })) } }
      } catch (err) {
        if (isNoSuchUpload(err)) throw gone()
        throw err
      }
    },

    async complete(req: Request): Promise<HandlerResult> {
      const ref = parseUploadRef(req.body)
      const totalParts = parseTotalParts(ref.body)
      await auth(req, ref.businessId, ref.projectId)

      try {
        // Los ETags los lee el servidor: el CORS del bucket no los expone al navegador.
        const parts = await deps.listParts(ref.storagePath, ref.uploadId)
        const missingParts = findMissingParts(parts, totalParts)
        if (missingParts.length > 0) {
          return { status: 409, body: { error: 'Faltan partes por subir', missingParts } }
        }
        const ordered = parts
          .filter((p) => p.partNumber >= 1 && p.partNumber <= totalParts)
          .sort((a, b) => a.partNumber - b.partNumber)
          .map((p) => ({ partNumber: p.partNumber, etag: p.etag }))
        await deps.completeUpload(ref.storagePath, ref.uploadId, ordered)
      } catch (err) {
        if (isNoSuchUpload(err)) throw gone()
        throw err
      }

      const isRaw = ref.storagePath.startsWith('raw/')
      return {
        status: 200,
        body: { storagePath: ref.storagePath, publicUrl: isRaw ? null : deps.publicUrlFor(ref.storagePath) },
      }
    },

    async abort(req: Request): Promise<HandlerResult> {
      const ref = parseUploadRef(req.body)
      await auth(req, ref.businessId, ref.projectId)
      try {
        await deps.abortUpload(ref.storagePath, ref.uploadId)
      } catch (err) {
        if (!isNoSuchUpload(err)) throw err // idempotente: ya no existe = éxito
      }
      return { status: 200, body: { aborted: true } }
    },
  }
}
