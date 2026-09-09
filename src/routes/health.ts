import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { Router } from 'express'

const execFileAsync = promisify(execFile)

export const healthRouter = Router()

healthRouter.get('/health', async (_req, res) => {
  // El health check confirma que ffmpeg —la dependencia crítica del
  // servicio— está instalado y ejecuta, no solo que el proceso Node arrancó.
  let ffmpeg: string | null = null
  try {
    const { stdout } = await execFileAsync('ffmpeg', ['-version'])
    ffmpeg = stdout.split('\n')[0] ?? null
  } catch {
    ffmpeg = null
  }

  res.status(200).json({ ok: true, ffmpeg })
})
