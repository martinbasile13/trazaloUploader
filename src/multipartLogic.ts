import { HttpError } from './errors.js'
import { isKind, extFromFilename, type Kind } from './keys.js'

// Lógica pura (sin red ni config) de la subida por partes.

export const PART_SIZE_BYTES = 8 * 1024 * 1024 // 8 MiB (R2 exige >= 5 MiB salvo la última)
export const MAX_FILE_BYTES = 150 * 1024 * 1024 // 150 MiB
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024
export const MAX_PARTS = 10_000
export const MAX_PART_URLS_PER_CALL = 20
export const PART_URL_EXPIRES_SECONDS = 3600

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/
const CONTENT_TYPE_RE = /^(video|image)\/[A-Za-z0-9.+-]{1,100}$/
const STORAGE_PATH_RE = /^[A-Za-z0-9._\-/]+$/
const EXT_RE = /^[a-z0-9]{1,10}$/

export function computeTotalParts(sizeBytes: number): number {
  return Math.ceil(sizeBytes / PART_SIZE_BYTES)
}

type Body = Record<string, unknown>

function asBody(body: unknown): Body {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'Faltan campos en el body')
  }
  return body as Body
}

function idField(body: Body, name: string): string {
  const v = body[name]
  if (typeof v !== 'string' || !ID_RE.test(v)) throw new HttpError(400, `Campo inválido: ${name}`)
  return v
}

function intField(body: Body, name: string, min: number, max: number): number {
  const v = body[name]
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
    throw new HttpError(400, `Campo inválido: ${name}`)
  }
  return v
}

// storagePath debe estar exactamente bajo media|raw/<businessId>/<projectId>/
export function validateStoragePath(value: unknown, businessId: string, projectId: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) {
    throw new HttpError(400, 'Campo inválido: storagePath')
  }
  if (!STORAGE_PATH_RE.test(value) || value.includes('..') || value.includes('//')) {
    throw new HttpError(400, 'Campo inválido: storagePath')
  }
  const okPrefix = [`media/${businessId}/${projectId}/`, `raw/${businessId}/${projectId}/`].some(
    (p) => value.startsWith(p) && value.length > p.length,
  )
  if (!okPrefix) throw new HttpError(403, 'storagePath no pertenece a este proyecto')
  return value
}

function uploadIdField(body: Body): string {
  const v = body.uploadId
  if (typeof v !== 'string' || v.length === 0 || v.length > 2048) {
    throw new HttpError(400, 'Campo inválido: uploadId')
  }
  return v
}

export interface Scope {
  businessId: string
  projectId: string
}

export function parseScope(raw: unknown): { body: Body } & Scope {
  const body = asBody(raw)
  return { body, businessId: idField(body, 'businessId'), projectId: idField(body, 'projectId') }
}

export interface CreateInput extends Scope {
  updateId: string
  ext: string
  contentType: string
  kind: Kind
  sizeBytes: number
}

export function parseCreate(raw: unknown): CreateInput {
  const { body, businessId, projectId } = parseScope(raw)
  const updateId = idField(body, 'updateId')

  const filename = body.filename
  if (typeof filename !== 'string' || filename.length === 0 || filename.length > 255) {
    throw new HttpError(400, 'Campo inválido: filename')
  }
  const contentType = body.contentType
  if (typeof contentType !== 'string' || !CONTENT_TYPE_RE.test(contentType)) {
    throw new HttpError(400, 'Campo inválido: contentType')
  }
  const kind = body.kind
  if (!isKind(kind)) throw new HttpError(400, 'Campo inválido: kind')

  const isVideo = contentType.startsWith('video/')
  if (kind === 'video-raw' ? !isVideo : isVideo) {
    throw new HttpError(400, 'contentType no coincide con kind')
  }

  const maxBytes = isVideo ? MAX_FILE_BYTES : MAX_IMAGE_BYTES
  const sizeBytes = intField(body, 'sizeBytes', 1, maxBytes)
  if (computeTotalParts(sizeBytes) > MAX_PARTS) throw new HttpError(400, 'Campo inválido: sizeBytes')

  // La extensión se sanea: buildKey la interpola tal cual en la key.
  const rawExt = extFromFilename(filename)
  const ext = EXT_RE.test(rawExt) ? rawExt : 'bin'

  return { businessId, projectId, updateId, ext, contentType, kind, sizeBytes }
}

export interface UploadRef extends Scope {
  storagePath: string
  uploadId: string
}

export function parseUploadRef(raw: unknown): UploadRef & { body: Body } {
  const { body, businessId, projectId } = parseScope(raw)
  return {
    body,
    businessId,
    projectId,
    storagePath: validateStoragePath(body.storagePath, businessId, projectId),
    uploadId: uploadIdField(body),
  }
}

export function parsePartNumbers(body: Body): number[] {
  const v = body.partNumbers
  if (!Array.isArray(v) || v.length === 0 || v.length > MAX_PART_URLS_PER_CALL) {
    throw new HttpError(400, 'Campo inválido: partNumbers')
  }
  const out: number[] = []
  for (const n of v) {
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > MAX_PARTS) {
      throw new HttpError(400, 'Campo inválido: partNumbers')
    }
    if (!out.includes(n)) out.push(n)
  }
  return out
}

export function parseTotalParts(body: Body): number {
  return intField(body, 'totalParts', 1, MAX_PARTS)
}

export interface ListedPart {
  partNumber: number
  size: number
  etag: string
}

// Devuelve los números de parte que faltan en 1..totalParts.
export function findMissingParts(parts: ListedPart[], totalParts: number): number[] {
  const have = new Set(parts.map((p) => p.partNumber))
  const missing: number[] = []
  for (let n = 1; n <= totalParts; n++) if (!have.has(n)) missing.push(n)
  return missing
}
