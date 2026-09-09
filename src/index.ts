import express from 'express'
import cors from 'cors'
import { config } from './config.js'
import { HttpError } from './auth.js'
import { healthRouter } from './routes/health.js'
import { presignRouter } from './routes/presign.js'
import { processVideoRouter } from './routes/processVideo.js'
import { deleteMediaRouter } from './routes/deleteMedia.js'

const app = express()

// Vite elige un puerto libre distinto cada vez que el 5173 está ocupado, así
// que fijar un puerto de localhost en ALLOWED_ORIGIN se rompe solo. En vez
// de eso, cualquier http://localhost:* pasa siempre; todo lo demás tiene que
// estar en la lista explícita (el dominio real de producción).
function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true
  if (config.allowedOrigins.includes('*')) return true
  if (config.allowedOrigins.includes(origin)) return true

  try {
    const { hostname, protocol } = new URL(origin)
    return protocol === 'http:' && (hostname === 'localhost' || hostname === '127.0.0.1')
  } catch {
    return false
  }
}

app.use(
  cors({
    origin: (origin, callback) => callback(null, isAllowedOrigin(origin)),
  }),
)
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
