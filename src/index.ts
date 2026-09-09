import express from 'express'
import cors from 'cors'
import { config } from './config.js'
import { HttpError } from './auth.js'
import { healthRouter } from './routes/health.js'
import { presignRouter } from './routes/presign.js'
import { processVideoRouter } from './routes/processVideo.js'
import { deleteMediaRouter } from './routes/deleteMedia.js'

const app = express()

app.use(cors({ origin: config.allowedOrigin }))
app.use(express.json({ limit: '1mb' }))

app.use(healthRouter)
app.use(presignRouter)
app.use(processVideoRouter)
app.use(deleteMediaRouter)

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message })
    return
  }
  console.error(err)
  res.status(500).json({ error: 'Error interno' })
})

app.listen(config.port, () => {
  console.log(`trazaloUploader escuchando en el puerto ${config.port}`)
})
