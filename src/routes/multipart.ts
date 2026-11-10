import { Router, type Request, type Response, type NextFunction } from 'express'
import { requireUser, assertOwnsProject } from '../auth.js'
import { publicUrlFor } from '../r2.js'
import * as r2m from '../r2Multipart.js'
import { createHandlers, capabilities, type HandlerResult } from '../multipartHandlers.js'

export const multipartRouter = Router()

const h = createHandlers({
  requireUser,
  assertOwnsProject,
  publicUrlFor,
  createUpload: r2m.createUpload,
  signPart: r2m.signPart,
  listParts: r2m.listParts,
  completeUpload: r2m.completeUpload,
  abortUpload: r2m.abortUpload,
})

function wrap(fn: (req: Request) => Promise<HandlerResult>) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { status, body } = await fn(req)
      res.status(status).json(body)
    } catch (err) {
      next(err)
    }
  }
}

// Sin auth: el cliente lo usa para detectar si el uploader soporta multipart.
multipartRouter.get('/capabilities', (_req, res) => {
  const { status, body } = capabilities()
  res.status(status).json(body)
})

multipartRouter.post('/multipart/create', wrap(h.create))
multipartRouter.post('/multipart/part-urls', wrap(h.partUrls))
multipartRouter.post('/multipart/list-parts', wrap(h.listParts))
multipartRouter.post('/multipart/complete', wrap(h.complete))
multipartRouter.post('/multipart/abort', wrap(h.abort))
