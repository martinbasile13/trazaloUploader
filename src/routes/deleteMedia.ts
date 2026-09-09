import { Router } from 'express'
import { requireUser, assertOwnsProject, HttpError } from '../auth.js'
import { deleteObjects } from '../r2.js'

export const deleteMediaRouter = Router()

// Reemplaza al supabase.storage.remove() de antes: el navegador ya no tiene
// credenciales para borrar de R2 directamente, así que pasa por acá.
deleteMediaRouter.post('/delete', async (req, res, next) => {
  try {
    const { businessId, projectId, storagePath, thumbnailPath } = req.body ?? {}

    if (!businessId || !projectId || !storagePath) {
      throw new HttpError(400, 'Faltan campos en el body')
    }

    const userId = await requireUser(req)
    await assertOwnsProject(userId, businessId, projectId)

    await deleteObjects([storagePath, thumbnailPath])

    res.status(200).json({ deleted: true })
  } catch (err) {
    next(err)
  }
})
