import crypto from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Router } from 'express'
import { requireUser, assertOwnsProject, HttpError } from '../auth.js'
import { downloadToFile, uploadFile, publicUrlFor, deleteObjects } from '../r2.js'
import { transcodeVideo } from '../ffmpeg.js'
import { supabaseAdmin } from '../supabase.js'
import { enqueue } from '../queue.js'

export const processVideoRouter = Router()

interface ProcessVideoJob {
  businessId: string
  projectId: string
  updateId: string
  mediaId: string
  rawStoragePath: string
}

processVideoRouter.post('/process-video', async (req, res, next) => {
  try {
    const { businessId, projectId, updateId, mediaId, rawStoragePath } = (req.body ?? {}) as Partial<ProcessVideoJob>

    if (!businessId || !projectId || !updateId || !mediaId || !rawStoragePath) {
      throw new HttpError(400, 'Faltan campos en el body')
    }

    const userId = await requireUser(req)
    await assertOwnsProject(userId, businessId, projectId)

    // Responde ya mismo: el transcode puede tardar bastante más que un
    // timeout de request razonable, así que corre aparte, en la cola.
    res.status(202).json({ accepted: true })

    enqueue(() => processVideoJob({ businessId, projectId, updateId, mediaId, rawStoragePath }))
  } catch (err) {
    next(err)
  }
})

async function processVideoJob(job: ProcessVideoJob): Promise<void> {
  const { businessId, projectId, updateId, mediaId, rawStoragePath } = job
  const workDir = await mkdtemp(join(tmpdir(), 'trazalo-'))
  const inputPath = join(workDir, 'input')
  const outputPath = join(workDir, 'output.mp4')

  try {
    await downloadToFile(rawStoragePath, inputPath)
    await transcodeVideo(inputPath, outputPath)

    const finalKey = `media/${businessId}/${projectId}/${updateId}/${crypto.randomUUID()}.mp4`
    await uploadFile(finalKey, outputPath, 'video/mp4')
    await deleteObjects([rawStoragePath])

    const { error } = await supabaseAdmin
      .from('media')
      .update({
        status: 'ready',
        storage_path: finalKey,
        public_url: publicUrlFor(finalKey),
        mime_type: 'video/mp4',
      })
      .eq('id', mediaId)

    if (error) throw error
  } catch (err) {
    console.error(`Error procesando video ${mediaId}:`, err)
    await supabaseAdmin.from('media').update({ status: 'failed' }).eq('id', mediaId)
  } finally {
    await rm(workDir, { recursive: true, force: true })
  }
}
