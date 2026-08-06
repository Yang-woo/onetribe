import imageCompression from 'browser-image-compression'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { imageAspectRatio, prepareForUpload, prepareThumb, validateFiles } from './client-image'
import {
  ALLOWED_MIME,
  IMAGE_MAX_DIM,
  IMAGE_MAX_ITERATIONS,
  IMAGE_QUALITY,
  MAX_FILES_PER_MOMENT,
  MAX_GIF_UPLOAD_BYTES,
  MAX_UPLOAD_BYTES,
  SHARE_CARD_FALLBACK_MIME,
  shareCardCanRender,
  SHARE_CARD_URL_RE,
  TARGET_IMAGE_BYTES,
  THUMB_MAX_DIM,
  THUMB_MIME,
  THUMB_QUALITY,
  THUMB_TARGET_BYTES,
} from './constants'

// Validation rules from docs/15 §2 (≤5 files) and docs/17 T2.1 (MIME/size).
// The canvas itself can't run in jsdom — actual pixel output is exercised by the
// upload E2E (T2.4). What IS testable here, and what silently rots otherwise, is
// the options contract we hand the compressor: the quality/resolution pins that
// keep a photo from being shrunk to hit a size target (D47) and the EXIF strip
// that keeps GPS out of a festival photo (D9 P6).
vi.mock('browser-image-compression', () => ({ default: vi.fn() }))
const compress = vi.mocked(imageCompression)
const photo = new File([new Uint8Array([0xff, 0xd8])], 'crowd.jpg', { type: 'image/jpeg' })

// harmless for the validateFiles block, which never reaches the compressor
beforeEach(() => {
  compress.mockReset()
})

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

  test('accepts a photo at the ceiling, rejects one byte over', () => {
    expect(validateFiles([{ type: 'image/jpeg', size: MAX_UPLOAD_BYTES }])).toBeNull()
    expect(validateFiles([jpeg, { type: 'image/png', size: MAX_UPLOAD_BYTES + 1 }])).toEqual({
      kind: 'too-large',
      index: 1,
      maxBytes: MAX_UPLOAD_BYTES,
    })
  })

  test('a GIF is held to its own tighter ceiling (D47 — GIFs are stored as picked)', () => {
    // The premise of the case below: an oversized GIF is still well under the
    // photo ceiling, so collapsing the two ceilings back into one would let it
    // through. Guard it so this test can never go vacuous.
    expect(MAX_GIF_UPLOAD_BYTES).toBeLessThan(MAX_UPLOAD_BYTES)

    expect(validateFiles([{ type: 'image/gif', size: MAX_GIF_UPLOAD_BYTES }])).toBeNull()
    expect(validateFiles([{ type: 'image/gif', size: MAX_GIF_UPLOAD_BYTES + 1 }])).toEqual({
      kind: 'too-large',
      index: 0,
      maxBytes: MAX_GIF_UPLOAD_BYTES,
    })
  })
})

describe('prepareForUpload', () => {
  const jpegOut = new File([new Uint8Array([1])], 'crowd.jpg', { type: 'image/jpeg' })
  const png = new File([new Uint8Array([0x89, 0x50])], 'crowd.png', { type: 'image/png' })
  const pngOut = new File([new Uint8Array([1])], 'crowd.png', { type: 'image/png' })

  test('GIFs pass through untouched (canvas would destroy the animation)', async () => {
    const gif = new File([new Uint8Array([0x47, 0x49, 0x46])], 'party.gif', {
      type: 'image/gif',
    })
    const prepared = await prepareForUpload(gif)
    expect(prepared).toBe(gif)
    expect(compress).not.toHaveBeenCalled()
  })

  test('a format the share card can draw is kept as-is (D47)', async () => {
    compress.mockResolvedValue(jpegOut)

    expect(await prepareForUpload(photo)).toBe(jpegOut)
    // Forcing a fileType here is what broke share cards: satori drops an image
    // it can't decode silently, so a WebP original publishes a photo-less card
    // and nothing fails loudly enough to notice.
    expect(compress.mock.calls[0][1]).not.toHaveProperty('fileType')

    compress.mockClear()
    await prepareForUpload(png)
    expect(compress.mock.calls[0][1]).not.toHaveProperty('fileType')
  })

  test('PNG is left to converge the library’s way — it has no quality knob (D47)', async () => {
    // PNG "quality" is palette size, which barely moves bytes on a photograph.
    // Pinning resolution there never reaches the target: measured 8.7MB out,
    // ~4x the old behaviour and near the presign ceiling that refuses outright.
    compress.mockResolvedValue(pngOut)
    await prepareForUpload(png)

    expect(compress.mock.calls[0][1]).not.toHaveProperty('alwaysKeepResolution')
    expect(compress.mock.calls[0][1]).not.toHaveProperty('maxIteration')
    // …while the pins that cost nothing on PNG stay
    expect(compress.mock.calls[0][1]).toMatchObject({
      initialQuality: IMAGE_QUALITY,
      maxWidthOrHeight: IMAGE_MAX_DIM,
      preserveExif: false,
    })
  })

  test('a format it cannot draw is converted — a .webp pick would lose its photo (D47)', async () => {
    compress.mockResolvedValue(jpegOut)
    const webpPick = new File([new Uint8Array([0x52, 0x49])], 'saved.webp', { type: 'image/webp' })

    await prepareForUpload(webpPick)
    expect(compress.mock.calls[0][1]).toMatchObject({
      fileType: SHARE_CARD_FALLBACK_MIME,
      // converting must not cost the pins — this is the same compression pass
      initialQuality: IMAGE_QUALITY,
      alwaysKeepResolution: true,
      maxWidthOrHeight: IMAGE_MAX_DIM,
      preserveExif: false,
    })
  })

  test('quality and resolution are pinned so the size target never costs pixels (D47)', async () => {
    compress.mockResolvedValue(jpegOut)
    await prepareForUpload(photo)

    expect(compress).toHaveBeenCalledTimes(1)
    expect(compress.mock.calls[0][1]).toMatchObject({
      // Left at the library default (1.0) the first pass overshoots the size
      // target, and the shrink loop then drops resolution AND quality together.
      initialQuality: IMAGE_QUALITY,
      alwaysKeepResolution: true,
      maxWidthOrHeight: IMAGE_MAX_DIM,
      maxSizeMB: TARGET_IMAGE_BYTES / (1024 * 1024),
      // bounds the quality floor on the one loop trigger the pins can't remove
      maxIteration: IMAGE_MAX_ITERATIONS,
      preserveExif: false, // D9 P6 — GPS must never survive the upload
    })
  })
})

describe('share card formats (D47)', () => {
  // The fact "satori draws JPEG and PNG only" is consumed in two shapes: the
  // uploader asks by MIME, the OG route asks by URL. They live next to each
  // other but nothing makes them agree — so assert it, across every type the
  // picker accepts. Drift here is invisible: a mismatch doesn't fail, it just
  // publishes moments whose share card has no photo.
  test('the MIME predicate and the URL pattern classify every allowed type alike', () => {
    for (const [mime, ext] of Object.entries(ALLOWED_MIME)) {
      expect({ mime, byUrl: SHARE_CARD_URL_RE.test(`https://media.test/x.${ext}`) }).toEqual({
        mime,
        byUrl: shareCardCanRender(mime),
      })
    }
  })

  test('the fallback is itself drawable — otherwise converting solves nothing', () => {
    expect(shareCardCanRender(SHARE_CARD_FALLBACK_MIME)).toBe(true)
    expect(SHARE_CARD_FALLBACK_MIME in ALLOWED_MIME).toBe(true) // presign enum
  })
})

describe('prepareThumb', () => {
  test('pins quality and resolution too — the default shrinks 640px thumbs (D21/D47)', async () => {
    const out = new File([new Uint8Array([1])], 'crowd_t.webp', { type: THUMB_MIME })
    compress.mockResolvedValue(out)

    expect(await prepareThumb(photo, true)).toBe(out)
    expect(compress.mock.calls[0][1]).toMatchObject({
      fileType: THUMB_MIME,
      initialQuality: THUMB_QUALITY,
      alwaysKeepResolution: true,
      maxWidthOrHeight: THUMB_MAX_DIM,
      maxSizeMB: THUMB_TARGET_BYTES / (1024 * 1024),
      preserveExif: false,
    })
  })

  test('rejects without canvas WebP instead of encoding bytes the server pins away', async () => {
    // The presign schema only accepts WebP thumbs (D21), so a PNG one would be
    // dropped by the wizard anyway — spend nothing producing it. Rejecting is
    // the documented best-effort contract; the wall falls back to media_url.
    await expect(prepareThumb(photo, false)).rejects.toThrow(/WebP/)
    expect(compress).not.toHaveBeenCalled()
  })
})

describe('imageAspectRatio (docs/00 D32, best-effort)', () => {
  const file = new File([new Uint8Array([1])], 'x.jpg', { type: 'image/jpeg' })
  const globalRef = globalThis as { createImageBitmap?: unknown }

  afterEach(() => {
    delete globalRef.createImageBitmap
    vi.restoreAllMocks()
  })

  test('returns width / height from the decoded bitmap', async () => {
    const close = vi.fn()
    globalRef.createImageBitmap = vi.fn(async () => ({ width: 1200, height: 800, close }))
    expect(await imageAspectRatio(file)).toBe(1.5)
    expect(close).toHaveBeenCalled() // no bitmap leak
  })

  test('null when the environment has no createImageBitmap (jsdom, older browsers)', async () => {
    expect(await imageAspectRatio(file)).toBeNull()
  })

  test('null when decoding throws or yields a degenerate size', async () => {
    globalRef.createImageBitmap = vi.fn(async () => {
      throw new Error('decode failed')
    })
    expect(await imageAspectRatio(file)).toBeNull()

    globalRef.createImageBitmap = vi.fn(async () => ({ width: 0, height: 0, close: vi.fn() }))
    expect(await imageAspectRatio(file)).toBeNull()
  })
})
