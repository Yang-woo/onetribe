import { describe, expect, test } from 'vitest'
import { prepareForUpload, validateFiles } from './client-image'
import { MAX_FILES_PER_MOMENT, MAX_UPLOAD_BYTES } from './constants'

// Validation rules from docs/15 §2 (≤5 files) and docs/17 T2.1 (MIME/size).
// The canvas compression path can't run in jsdom — it is exercised by the
// upload E2E (T2.4); the GIF passthrough contract is testable here.

describe('validateFiles', () => {
  const jpeg = { type: 'image/jpeg', size: 1024 }

  test('accepts up to the batch limit of allowed types', () => {
    expect(validateFiles(Array.from({ length: MAX_FILES_PER_MOMENT }, () => jpeg))).toBeNull()
  })

  test('rejects more than the batch limit', () => {
    const result = validateFiles(Array.from({ length: MAX_FILES_PER_MOMENT + 1 }, () => jpeg))
    expect(result).toEqual({ kind: 'too-many', max: MAX_FILES_PER_MOMENT })
  })

  test('rejects video and unknown types with the offending index', () => {
    expect(validateFiles([jpeg, { type: 'video/mp4', size: 10 }])).toEqual({
      kind: 'unsupported-type',
      index: 1,
      type: 'video/mp4',
    })
    expect(validateFiles([{ type: '', size: 10 }])).toEqual({
      kind: 'unsupported-type',
      index: 0,
      type: 'unknown',
    })
  })

  test('rejects files over the presign ceiling', () => {
    expect(validateFiles([jpeg, { type: 'image/png', size: MAX_UPLOAD_BYTES + 1 }])).toEqual({
      kind: 'too-large',
      index: 1,
      maxBytes: MAX_UPLOAD_BYTES,
    })
  })
})

describe('prepareForUpload', () => {
  test('GIFs pass through untouched (canvas would destroy the animation)', async () => {
    const gif = new File([new Uint8Array([0x47, 0x49, 0x46])], 'party.gif', {
      type: 'image/gif',
    })
    const prepared = await prepareForUpload(gif)
    expect(prepared).toBe(gif)
  })
})
