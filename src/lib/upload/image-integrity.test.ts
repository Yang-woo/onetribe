import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  detailRatio,
  FLAT_DETAIL,
  looksIntact,
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
    expect(ratio!).toBeGreaterThan(0.5)
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

  test('a sample too small to have neighbours says so — on either axis', () => {
    expect(detailRatio(buffer(noise, 1, 1), 1, 1)).toBeNull()
    expect(detailRatio(buffer(noise, 1, 8), 1, 8)).toBeNull()
    // and the height half of that guard, which the two cases above both miss
    expect(detailRatio(buffer(noise, 8, 1), 8, 1)).toBeNull()
  })

  test('a buffer smaller than the frame it claims reads as "cannot tell"', () => {
    // Reading past the end yields NaN, and NaN slips through the flatness
    // escape (`NaN < FLAT_DETAIL` is false) to come back as "broken" — the
    // inverse of this module's contract. Exported and called directly, so the
    // dimensions are not guaranteed to match the way looksIntact makes them.
    expect(detailRatio(buffer(noise, W, H).slice(0, 64), W, H)).toBeNull()
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
    expect(ratio!).toBeGreaterThan(0.4)
  })
})

/**
 * `looksIntact` answers `true` for anything it could not do, and that shrug is
 * load-bearing: flip any of these branches and a browser without the canvas
 * this needs would re-compress every single upload, doubling the stall D50
 * measured and decided to leave alone. jsdom has none of the APIs, so each
 * branch has to be stood up here — the browser-side path is covered for real in
 * e2e-browser/image-integrity.spec.ts.
 */
describe('looksIntact — what it does when it cannot look', () => {
  afterEach(() => vi.unstubAllGlobals())

  const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' })
  const bitmap = { width: 640, height: 480, close: () => {} }

  test('no createImageBitmap at all → intact', async () => {
    // jsdom's own state, and the reason none of the pipeline tests exercise the
    // real function: it leaves before touching a canvas
    expect(typeof createImageBitmap).toBe('undefined')
    expect(await looksIntact(blob)).toBe(true)
  })

  test('no canvas to draw into → intact', async () => {
    vi.stubGlobal('createImageBitmap', async () => bitmap)
    vi.stubGlobal('OffscreenCanvas', undefined)
    vi.stubGlobal('document', undefined)
    expect(await looksIntact(blob)).toBe(true)
  })

  test('a canvas that hands back no 2d context → intact', async () => {
    vi.stubGlobal('createImageBitmap', async () => bitmap)
    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        getContext() {
          return null
        }
      },
    )
    expect(await looksIntact(blob)).toBe(true)
  })

  test('an undecodable file → intact', async () => {
    vi.stubGlobal('createImageBitmap', async () => {
      throw new Error('not an image')
    })
    expect(await looksIntact(blob)).toBe(true)
  })

  test('a verdict already reached survives a failing bitmap.close()', async () => {
    // the one direction that would turn a corruption we DID detect into a clean
    // bill of health, by letting the outer catch answer instead
    const rows = new Uint8ClampedArray(SAMPLE_WIDTH * 8 * 4)
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < SAMPLE_WIDTH; x++) {
        const i = (y * SAMPLE_WIDTH + x) * 4
        const v = (x * 97) % 251
        rows[i] = rows[i + 1] = rows[i + 2] = v
        rows[i + 3] = 255
      }
    }
    vi.stubGlobal('createImageBitmap', async () => ({
      width: SAMPLE_WIDTH,
      height: 8,
      close: () => {
        throw new Error('already detached')
      },
    }))
    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        getContext() {
          return {
            drawImage: () => {},
            getImageData: () => ({ data: rows, width: SAMPLE_WIDTH, height: 8 }),
          }
        }
      },
    )
    expect(await looksIntact(blob)).toBe(false)
  })
})
