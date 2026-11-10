import { Router } from 'express'
import { requireUser, assertOwnsProject, HttpError } from '../auth.js'
import { isKind, extFromFilename, buildKey } from '../keys.js'
import { presignPut, publicUrlFor } from '../r2.js'

export const presignRouter = Router()

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
