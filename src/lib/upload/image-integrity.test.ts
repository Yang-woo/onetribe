import { describe, expect, test } from 'vitest'
import {
  DEGENERATE_RATIO,
  detailRatio,
  FLAT_DETAIL,
  ratioLooksIntact,
  SAMPLE_WIDTH,
} from './image-integrity'

/**
 * The judgement, against exact pixel buffers — docs/00 D56. The browser half
 * (decode → canvas → read back) cannot run in jsdom and is exercised on real
 * encoded files in e2e/image-integrity.spec.ts; what lives here is the
 * arithmetic that decides.
 *
 * The shapes below are the ones measured off the real artifact: the stored
 * broken photo is one distinct row repeated 1800 times with every column pair
 * still differing. `rows` builds exactly that.
 */

const W = SAMPLE_WIDTH
const H = 48

/** RGBA buffer from a luma function — grey, so all three channels agree. */
function buffer(at: (x: number, y: number) => number, width = W, height = H) {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = Math.max(0, Math.min(255, Math.round(at(x, y))))
      const i = (y * width + x) * 4
      data[i] = data[i + 1] = data[i + 2] = v
      data[i + 3] = 255
    }
  }
  return data
}

// deterministic, and busy enough on both axes to be an ordinary photograph
const noise = (x: number, y: number) => ((x * 73 + y * 149) % 97) * 2.6

describe('detailRatio', () => {
  test('an ordinary image is busy on both axes', () => {
    const ratio = detailRatio(buffer(noise), W, H)
    expect(ratio).not.toBeNull()
    expect(ratio!).toBeGreaterThan(DEGENERATE_RATIO * 10)
    expect(ratioLooksIntact(ratio)).toBe(true)
  })

  test('identical rows read as degenerate — the shape the real artifact has', () => {
    // every row the same, every column different: measured off the stored
    // 2400×1800 file, which has exactly one distinct row and 2399 differing
    // column pairs
    const ratio = detailRatio(
      buffer((x) => noise(x, 0)),
      W,
      H,
    )
    expect(ratio).toBe(0)
    expect(ratioLooksIntact(ratio)).toBe(false)
  })

  test('identical COLUMNS read as degenerate too', () => {
    // The compressor transposes when it applies EXIF orientation itself
    // (orientations 5–8, which includes an ordinary portrait phone photo), so
    // the same misalignment can land on the other axis. A one-sided test — the
    // first version of this — calls a vertical gradient perfectly healthy.
    const ratio = detailRatio(
      buffer((_x, y) => noise(0, y)),
      W,
      H,
    )
    expect(ratio).toBe(0)
    expect(ratioLooksIntact(ratio)).toBe(false)
  })

  test('a flat image is not evidence of anything', () => {
    // both axes quiet: nothing to compare, and "I cannot tell" must not read as
    // "broken" or every near-black night sky would be retried forever
    expect(
      detailRatio(
        buffer(() => 40),
        W,
        H,
      ),
    ).toBeNull()
    expect(ratioLooksIntact(null)).toBe(true)
  })

  test('flatness is judged on the busier axis, not on both', () => {
    // A quiet-but-not-flat stripe pattern: rows identical, columns varying by
    // just over the flatness floor. Requiring BOTH axes to clear FLAT_DETAIL
    // would return null here — and null means "intact", so the corruption
    // would walk straight through on any image that is not also bright.
    const step = FLAT_DETAIL * 4
    const ratio = detailRatio(
      buffer((x) => 40 + (x % 2) * step),
      W,
      H,
    )
    expect(ratio).toBe(0)
    expect(ratioLooksIntact(ratio)).toBe(false)
  })

  test('a sample too small to have neighbours says so', () => {
    expect(detailRatio(buffer(noise, 1, 1), 1, 1)).toBeNull()
    expect(detailRatio(buffer(noise, 1, 8), 1, 8)).toBeNull()
  })

  test('the ratio is symmetric — neither axis is privileged', () => {
    // rows-degenerate and columns-degenerate must score the same, or the check
    // protects one orientation better than the other
    const rows = detailRatio(
      buffer((x) => noise(x, 0)),
      W,
      W,
    )
    const cols = detailRatio(
      buffer((_x, y) => noise(y, 0)),
      W,
      W,
    )
    expect(rows).toBe(cols)
  })

  test('a merely anisotropic image is not called broken', () => {
    // twice as much detail across as down is a normal photograph, and the real
    // wall's 220 photos never came below 0.58
    const ratio = detailRatio(
      buffer((x, y) => noise(x, y) * 0.5 + noise(x, 0) * 0.5),
      W,
      H,
    )
    expect(ratio!).toBeGreaterThan(DEGENERATE_RATIO * 20)
  })
})
