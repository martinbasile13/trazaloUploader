import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { Router } from 'express'
import { checkR2Health } from '../r2.js'

const execFileAsync = promisify(execFile)

export const healthRouter = Router()

healthRouter.get('/health', async (_req, res) => {
  // El health check confirma que ffmpeg —la dependencia crítica del
  // servicio— está instalado y ejecuta, no solo que el proceso Node arrancó.
  // R2 corre en paralelo: es la otra dependencia externa real del servicio.
  const [ffmpegResult, r2] = await Promise.all([
    execFileAsync('ffmpeg', ['-version'])
      .then(({ stdout }) => stdout.split('\n')[0] ?? null)
      .catch(() => null),
    checkR2Health(),
  ])

  res.status(200).json({ ok: true, ffmpeg: ffmpegResult, r2 })
})
