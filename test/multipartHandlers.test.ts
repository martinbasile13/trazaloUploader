import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Request } from 'express'
import { HttpError } from '../src/errors.ts'
import { createHandlers, capabilities, type MultipartDeps } from '../src/multipartHandlers.ts'

const B = 'biz-1'
const P = 'proj-1'
const PATH = `raw/${B}/${P}/u/x.mp4`
const req = (body: unknown) => ({ body }) as unknown as Request

function makeDeps(over: Partial<MultipartDeps> = {}) {
  const calls: string[] = []
  const deps: MultipartDeps = {
    requireUser: async () => 'user-1',
    assertOwnsProject: async () => {
      calls.push('own')
    },
    publicUrlFor: (k) => `https://cdn/${k}`,
    createUpload: async () => 'UP1',
    signPart: async (_k, _u, n) => `https://signed/${n}`,
    listParts: async () => [],
    completeUpload: async () => {
      calls.push('complete')
    },
    abortUpload: async () => {
      calls.push('abort')
    },
    ...over,
  }
  return { deps, calls }
}

async function rejects(p: Promise<unknown>, status: number) {
  await assert.rejects(p, (e) => e instanceof HttpError && e.status === status)
}

const ref = { businessId: B, projectId: P, storagePath: PATH, uploadId: 'UP1' }
const part = (n: number) => ({ partNumber: n, size: 8, etag: `"e${n}"` })
const createBody = { businessId: B, projectId: P, updateId: 'u', filename: 'v.mp4', contentType: 'video/mp4', kind: 'video-raw', sizeBytes: 20 * 1024 * 1024 }

test('capabilities', () => {
  assert.deepEqual(capabilities().body, { multipart: true, partSizeBytes: 8388608, maxFileBytes: 157286400 })
})

test('create video-raw: publicUrl null, partes calculadas', async () => {
  const { deps } = makeDeps()
  const r = await createHandlers(deps).create(req(createBody))
  const body = r.body as any
  assert.equal(r.status, 200)
  assert.equal(body.uploadId, 'UP1')
  assert.equal(body.publicUrl, null)
  assert.equal(body.totalParts, 3)
  assert.equal(body.partSizeBytes, 8388608)
  assert.match(body.storagePath, new RegExp(`^raw/${B}/${P}/u/[0-9a-f-]{36}\\.mp4$`))
})

test('create imagen: publicUrl presente', async () => {
  const { deps } = makeDeps()
  const r = await createHandlers(deps).create(
    req({ ...createBody, filename: 'a.jpg', contentType: 'image/jpeg', kind: 'image', sizeBytes: 100 }),
  )
  const body = r.body as any
  assert.equal(body.publicUrl, `https://cdn/${body.storagePath}`)
})

test('sin auth o sin ownership no se toca S3', async () => {
  let touched = false
  const noAuth = makeDeps({
    requireUser: async () => {
      throw new HttpError(401, 'Token inválido')
    },
    createUpload: async () => {
      touched = true
      return 'x'
    },
    listParts: async () => {
      touched = true
      return []
    },
  })
  const h = createHandlers(noAuth.deps)
  await rejects(h.create(req(createBody)), 401)
  await rejects(h.listParts(req(ref)), 401)
  const noOwn = makeDeps({
    assertOwnsProject: async () => {
      throw new HttpError(403, 'No pertenecés a este negocio')
    },
    abortUpload: async () => {
      touched = true
    },
  })
  await rejects(createHandlers(noOwn.deps).abort(req(ref)), 403)
  assert.equal(touched, false)
})

test('storagePath de otro negocio se rechaza antes de tocar S3', async () => {
  let touched = false
  const { deps } = makeDeps({
    abortUpload: async () => {
      touched = true
    },
  })
  await rejects(createHandlers(deps).abort(req({ ...ref, storagePath: `raw/otro/${P}/u/x.mp4` })), 403)
  assert.equal(touched, false)
})

test('part-urls firma y deduplica', async () => {
  const { deps } = makeDeps()
  const r = await createHandlers(deps).partUrls(req({ ...ref, partNumbers: [1, 2, 2] }))
  assert.deepEqual(r.body, { urls: [{ partNumber: 1, url: 'https://signed/1' }, { partNumber: 2, url: 'https://signed/2' }] })
  await rejects(createHandlers(deps).partUrls(req({ ...ref, partNumbers: [] })), 400)
})

test('list-parts no filtra el etag', async () => {
  const { deps } = makeDeps({ listParts: async () => [part(1), part(2)] })
  const r = await createHandlers(deps).listParts(req(ref))
  assert.deepEqual(r.body, { parts: [{ partNumber: 1, size: 8 }, { partNumber: 2, size: 8 }] })
})

test('complete: partes faltantes -> 409 con missingParts y sin completar', async () => {
  const { deps, calls } = makeDeps({ listParts: async () => [part(1), part(3)] })
  const r = await createHandlers(deps).complete(req({ ...ref, totalParts: 3 }))
  assert.equal(r.status, 409)
  assert.deepEqual((r.body as any).missingParts, [2])
  assert.ok(!calls.includes('complete'))
})

test('complete: ok, ordena partes y devuelve publicUrl null para raw', async () => {
  let sent: unknown
  const { deps } = makeDeps({
    listParts: async () => [part(2), part(1), part(3)],
    completeUpload: async (_k, _u, parts) => {
      sent = parts
    },
  })
  const r = await createHandlers(deps).complete(req({ ...ref, totalParts: 2 }))
  assert.equal(r.status, 200)
  assert.deepEqual(r.body, { storagePath: PATH, publicUrl: null })
  assert.deepEqual(sent, [{ partNumber: 1, etag: '"e1"' }, { partNumber: 2, etag: '"e2"' }])
})

test('complete media: publicUrl', async () => {
  const path = `media/${B}/${P}/u/x.jpg`
  const { deps } = makeDeps({ listParts: async () => [part(1)] })
  const r = await createHandlers(deps).complete(req({ ...ref, storagePath: path, totalParts: 1 }))
  assert.deepEqual(r.body, { storagePath: path, publicUrl: `https://cdn/${path}` })
})

test('NoSuchUpload: complete/list -> 404; abort idempotente', async () => {
  const err = Object.assign(new Error('x'), { name: 'NoSuchUpload' })
  const { deps } = makeDeps({
    listParts: async () => {
      throw err
    },
    abortUpload: async () => {
      throw err
    },
  })
  const h = createHandlers(deps)
  await rejects(h.complete(req({ ...ref, totalParts: 1 })), 404)
  await rejects(h.listParts(req(ref)), 404)
  assert.deepEqual((await h.abort(req(ref))).body, { aborted: true })
})

test('errores inesperados de S3 se propagan (el middleware responde 500 genérico)', async () => {
  const { deps } = makeDeps({
    abortUpload: async () => {
      throw new Error('boom')
    },
  })
  await assert.rejects(createHandlers(deps).abort(req(ref)), /boom/)
})
