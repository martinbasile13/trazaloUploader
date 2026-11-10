import { test } from 'node:test'
import assert from 'node:assert/strict'
import { HttpError } from '../src/errors.ts'
import { buildKey } from '../src/keys.ts'
import {
  PART_SIZE_BYTES,
  MAX_FILE_BYTES,
  computeTotalParts,
  validateStoragePath,
  parseCreate,
  parsePartNumbers,
  findMissingParts,
} from '../src/multipartLogic.ts'

const B = 'biz-1'
const P = 'proj-1'
const base = { businessId: B, projectId: P, updateId: 'upd-1', filename: 'a.MOV', contentType: 'video/quicktime', kind: 'video-raw', sizeBytes: 1000 }

function status(fn: () => unknown): number {
  try {
    fn()
  } catch (e) {
    if (e instanceof HttpError) return e.status
    throw e
  }
  return 0
}

test('computeTotalParts', () => {
  assert.equal(computeTotalParts(1), 1)
  assert.equal(computeTotalParts(PART_SIZE_BYTES), 1)
  assert.equal(computeTotalParts(PART_SIZE_BYTES + 1), 2)
  assert.equal(computeTotalParts(MAX_FILE_BYTES), 19)
})

test('buildKey mantiene el esquema', () => {
  assert.match(buildKey('b', 'p', 'u', 'video-raw', 'mp4'), /^raw\/b\/p\/u\/[0-9a-f-]{36}\.mp4$/)
  assert.match(buildKey('b', 'p', 'u', 'image', 'jpg'), /^media\/b\/p\/u\/[0-9a-f-]{36}\.jpg$/)
  assert.match(buildKey('b', 'p', 'u', 'thumbnail', 'jpg'), /^media\/b\/p\/u\/[0-9a-f-]{36}_thumb\.jpg$/)
})

test('validateStoragePath', () => {
  assert.equal(validateStoragePath(`raw/${B}/${P}/u/x.mp4`, B, P), `raw/${B}/${P}/u/x.mp4`)
  assert.equal(validateStoragePath(`media/${B}/${P}/u/x.jpg`, B, P), `media/${B}/${P}/u/x.jpg`)
  assert.equal(status(() => validateStoragePath(`media/other/${P}/u/x.jpg`, B, P)), 403)
  assert.equal(status(() => validateStoragePath(`media/${B}/${P}x/u/x.jpg`, B, P)), 403)
  assert.equal(status(() => validateStoragePath(`media/${B}/${P}/`, B, P)), 403)
  assert.equal(status(() => validateStoragePath(`media/${B}/${P}/../x`, B, P)), 400)
  assert.equal(status(() => validateStoragePath(`media/${B}/${P}//x`, B, P)), 400)
  assert.equal(status(() => validateStoragePath(`media/${B}/${P}/a b`, B, P)), 400)
  assert.equal(status(() => validateStoragePath(`media/${B}/${P}/a?x=1`, B, P)), 400)
  assert.equal(status(() => validateStoragePath(123, B, P)), 400)
})

test('parseCreate valida y sanea', () => {
  assert.equal(parseCreate(base).ext, 'mov')
  assert.equal(parseCreate({ ...base, filename: 'noext/..' }).ext, 'bin')
  assert.equal(status(() => parseCreate(null)), 400)
  assert.equal(status(() => parseCreate({ ...base, businessId: 'a/b' })), 400)
  assert.equal(status(() => parseCreate({ ...base, kind: 'otro' })), 400)
  assert.equal(status(() => parseCreate({ ...base, contentType: 'application/pdf' })), 400)
  assert.equal(status(() => parseCreate({ ...base, kind: 'image' })), 400)
  assert.equal(status(() => parseCreate({ ...base, sizeBytes: 0 })), 400)
  assert.equal(status(() => parseCreate({ ...base, sizeBytes: 1.5 })), 400)
  assert.equal(status(() => parseCreate({ ...base, sizeBytes: '10' })), 400)
  assert.equal(status(() => parseCreate({ ...base, sizeBytes: MAX_FILE_BYTES + 1 })), 400)
  parseCreate({ ...base, sizeBytes: MAX_FILE_BYTES })
  const img = { ...base, kind: 'image', contentType: 'image/jpeg', filename: 'a.jpg' }
  parseCreate({ ...img, sizeBytes: 25 * 1024 * 1024 })
  assert.equal(status(() => parseCreate({ ...img, sizeBytes: 25 * 1024 * 1024 + 1 })), 400)
})

test('parsePartNumbers', () => {
  assert.deepEqual(parsePartNumbers({ partNumbers: [1, 2, 2, 3] }), [1, 2, 3])
  assert.equal(status(() => parsePartNumbers({ partNumbers: [] })), 400)
  assert.equal(status(() => parsePartNumbers({ partNumbers: [0] })), 400)
  assert.equal(status(() => parsePartNumbers({ partNumbers: [10001] })), 400)
  assert.equal(status(() => parsePartNumbers({ partNumbers: [1.2] })), 400)
  assert.equal(status(() => parsePartNumbers({ partNumbers: ['1'] })), 400)
  assert.equal(status(() => parsePartNumbers({ partNumbers: Array.from({ length: 21 }, (_, i) => i + 1) })), 400)
  assert.equal(parsePartNumbers({ partNumbers: Array.from({ length: 20 }, (_, i) => i + 1) }).length, 20)
})

test('findMissingParts', () => {
  const p = (n: number) => ({ partNumber: n, size: 1, etag: 'e' })
  assert.deepEqual(findMissingParts([p(1), p(3)], 4), [2, 4])
  assert.deepEqual(findMissingParts([p(1), p(2)], 2), [])
})
