import crypto from 'node:crypto'
import { Router } from 'express'
import { requireUser, assertOwnsProject, HttpError } from '../auth.js'
import { presignPut, publicUrlFor } from '../r2.js'

export const presignRouter = Router()

const ALLOWED_KINDS = ['image', 'thumbnail', 'video-raw'] as const
type Kind = (typeof ALLOWED_KINDS)[number]

function isKind(value: unknown): value is Kind {
  return typeof value === 'string' && (ALLOWED_KINDS as readonly string[]).includes(value)
}

function extFromFilename(filename: string): string {
  const ext = filename.split('.').pop()
  return ext ? ext.toLowerCase() : 'bin'
}

// Mismo esquema de paths que storage.ts en trazaloApp:
// {businessId}/{projectId}/{updateId}/{filename} — con un prefijo por tipo
// para poder distinguir de un vistazo qué es crudo y qué es final en el bucket.
function buildKey(businessId: string, projectId: string, updateId: string, kind: Kind, ext: string): string {
  const uuid = crypto.randomUUID()
  const prefix = kind === 'video-raw' ? 'raw' : 'media'
  const suffix = kind === 'thumbnail' ? '_thumb' : ''
  return `${prefix}/${businessId}/${projectId}/${updateId}/${uuid}${suffix}.${ext}`
}

presignRouter.post('/presign', async (req, res, next) => {
  try {
    const { businessId, projectId, updateId, filename, contentType, kind } = req.body ?? {}

    if (!businessId || !projectId || !updateId || !filename || !contentType) {
      throw new HttpError(400, 'Faltan campos en el body')
    }
    if (!isKind(kind)) {
      throw new HttpError(400, `kind inválido: ${String(kind)}`)
    }

    const userId = await requireUser(req)
    await assertOwnsProject(userId, businessId, projectId)

    const key = buildKey(businessId, projectId, updateId, kind, extFromFilename(filename))
    const uploadUrl = await presignPut(key, contentType)

    // El crudo de video no tiene URL pública final todavía — se genera
    // recién cuando /process-video termina de transcodificar.
    res.status(200).json({
      uploadUrl,
      storagePath: key,
      publicUrl: kind === 'video-raw' ? null : publicUrlFor(key),
    })
  } catch (err) {
    next(err)
  }
})
