import { describe, expect, test } from 'vitest'
import {
  DEGENERATE_RATIO,
  detailRatio,
  fitsWithoutCompression,
  looksIntact,
  ratioLooksIntact,
} from './image-integrity'
import { MAX_PRESIGN_BYTES } from './constants'

/**
 * The detector from docs/00 D56, against exact pixel buffers.
 *
 * The case that matters is the one that actually shipped to the wall: every
 * row identical, which is a picture of nothing but is NOT flat — the reported
 * photo measured sd=22, so anything built on "is this image blank" waves it
 * through. These buffers reproduce that shape rather than describing it.
 *
 * The browser half (decode → draw → read back) needs a canvas, which jsdom has
 * no implementation of; `looksIntact` is therefore asserted here only on the
 * contract it must honour when it CANNOT measure.
 */

/** RGBA buffer from a per-pixel luma function. */
function buffer(width: number, height: number, luma: (x: number, y: number) => number) {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = Math.max(0, Math.min(255, Math.round(luma(x, y))))
      const i = (y * width + x) * 4
      data[i] = data[i + 1] = data[i + 2] = v
      data[i + 3] = 255
    }
  }
  return data
}

function stddev(data: Uint8ClampedArray) {
  const values: number[] = []
  for (let i = 0; i < data.length; i += 4) values.push(data[i])
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  return Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length)
}

// A deterministic stand-in for photographic noise — structure on both axes.
const photo = (x: number, y: number) =>
  128 + 60 * Math.sin(x / 3) + 40 * Math.cos(y / 4) + ((x * 7 + y * 13) % 17)

// The corruption: one row of real variation, repeated down the whole image.
const stripes = (x: number) => 128 + 31 * Math.sin(x / 2.5) + ((x * 11) % 13)

describe('detailRatio', () => {
  test('a picture with structure on both axes reads as ordinary', () => {
    const ratio = detailRatio(buffer(64, 48, photo), 64, 48)
    expect(ratio).not.toBeNull()
    // the field measurements put real photographs at 0.67–1.68 (median 0.98)
    expect(ratio!).toBeGreaterThan(DEGENERATE_RATIO)
  })

  test('identical rows read as degenerate — and are NOT flat', () => {
    const data = buffer(64, 48, (x) => stripes(x))
    // the trap this check exists for: a standard-deviation test sees an
    // ordinary photograph here (the real one measured sd=22) and passes it
    expect(stddev(data)).toBeGreaterThan(15)

    const ratio = detailRatio(data, 64, 48)
    expect(ratio).toBe(0)
    expect(ratioLooksIntact(ratio)).toBe(false)
  })

  test('a solid colour is unjudgeable, not broken', () => {
    // both axes are zero, so the ratio carries no information — and a blank
    // image is a legitimate thing to upload
    const ratio = detailRatio(
      buffer(64, 48, () => 200),
      64,
      48,
    )
    expect(ratio).toBeNull()
    expect(ratioLooksIntact(ratio)).toBe(true)
  })

  test('a nearly-flat gradient is unjudgeable rather than condemned', () => {
    // horizontal detail below FLAT_DETAIL: real, but far too little to draw a
    // conclusion from. Condemning this would discard good compressions.
    const ratio = detailRatio(
      buffer(64, 48, (x) => 128 + x * 0.1),
      64,
      48,
    )
    expect(ratio).toBeNull()
  })

  test('an anisotropic but real photo survives', () => {
    // vertical fence posts against a plain sky: genuinely much more horizontal
    // detail than vertical. It must clear the bar, or the check would tax a
    // whole class of legitimate photos
    const ratio = detailRatio(
      buffer(64, 48, (x, y) => 128 + 60 * Math.sin(x / 2) + 2 * Math.sin(y / 5)),
      64,
      48,
    )
    expect(ratio).not.toBeNull()
    expect(ratioLooksIntact(ratio)).toBe(true)
  })

  // A documented limit, not an oversight. Identical COLUMNS read as
  // unjudgeable, so this detector would not catch that mirror image. It is not
  // a shape this pipeline can produce — the failure is a row-stride
  // misalignment while drawing, which repeats rows; a canvas has no path that
  // transposes. Widening the test to min/max of both axes would catch it, at
  // the price of taxing genuinely anisotropic photos (the fence-post case
  // above), so the check stays pointed at the failure that actually shipped.
  test('identical columns are NOT judged — the detector is aimed at one axis', () => {
    const data = buffer(64, 48, (_x, y) => stripes(y))
    expect(detailRatio(data, 64, 48)).toBeNull()
  })

  test('a buffer too small to have neighbours is unjudgeable', () => {
    expect(
      detailRatio(
        buffer(1, 1, () => 10),
        1,
        1,
      ),
    ).toBeNull()
  })
})

describe('looksIntact', () => {
  test('resolves true when it cannot measure at all', async () => {
    // jsdom has no createImageBitmap. A check that blocked uploads it failed to
    // perform would be worse than the bug it exists to catch.
    expect(typeof createImageBitmap).not.toBe('function')
    await expect(looksIntact(new Blob(['not an image']))).resolves.toBe(true)
  })
})

describe('fitsWithoutCompression', () => {
  test('the fallback is bounded by the presign ceiling, not the picker cap', () => {
    // a photo may be PICKED at up to 20MB (docs/00 D47) but the server's
    // presign ceiling is the smaller GIF one — sending the original blindly
    // would trade a broken photo for a rejected upload
    expect(fitsWithoutCompression({ size: MAX_PRESIGN_BYTES } as Blob)).toBe(true)
    expect(fitsWithoutCompression({ size: MAX_PRESIGN_BYTES + 1 } as Blob)).toBe(false)
  })
})
