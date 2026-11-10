import crypto from 'node:crypto'

export const ALLOWED_KINDS = ['image', 'thumbnail', 'video-raw'] as const
export type Kind = (typeof ALLOWED_KINDS)[number]

export function isKind(value: unknown): value is Kind {
  return typeof value === 'string' && (ALLOWED_KINDS as readonly string[]).includes(value)
}

export function extFromFilename(filename: string): string {
  const ext = filename.split('.').pop()
  return ext ? ext.toLowerCase() : 'bin'
}

// Mismo esquema de paths que storage.ts en trazaloApp:
// {businessId}/{projectId}/{updateId}/{filename} — con un prefijo por tipo
// para poder distinguir de un vistazo qué es crudo y qué es final en el bucket.
export function buildKey(businessId: string, projectId: string, updateId: string, kind: Kind, ext: string): string {
  const uuid = crypto.randomUUID()
  const prefix = kind === 'video-raw' ? 'raw' : 'media'
  const suffix = kind === 'thumbnail' ? '_thumb' : ''
  return `${prefix}/${businessId}/${projectId}/${updateId}/${uuid}${suffix}.${ext}`
}
