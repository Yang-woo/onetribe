import { MAX_PRESIGN_BYTES } from './constants'

/**
 * Did the canvas draw a picture, or garbage? — docs/00 D56.
 *
 * A photo that came in through the Reddit launch landed on the wall as a
 * column of identical vertical stripes: every row of pixels was the same,
 * because the pixel buffer had been drawn into the canvas misaligned. R2
 * answered 200, the row was valid, the thumbnail was broken the same way, and
 * the server never looks at what a picture contains — so nothing anywhere
 * noticed. The same person's next upload two minutes later was fine, so this
 * is an intermittent decode failure inside the client compression step, not a
 * broken file.
 *
 * The tell is that the corruption is *structured*: rows repeat exactly, so
 * vertically adjacent pixels never differ, while horizontally adjacent ones
 * still do. A flatness test (standard deviation) does not catch it — the
 * reported photo measured sd=22, which is an ordinary-looking photograph.
 *
 * False positives are cheap here and that shapes the thresholds: a photo
 * wrongly judged broken is uploaded as its ORIGINAL instead of its compressed
 * version — same picture, more bytes. So the check is deliberately timid about
 * calling something broken, and the fallback is free to be decisive.
 */

/** Width the sample is drawn at. Small enough to be free, big enough to have
 *  structure — the ratio below is scale-invariant, not a pixel comparison. */
export const SAMPLE_WIDTH = 64

/**
 * Below this, vertical detail has effectively vanished while horizontal detail
 * survives — the signature above. Real photographs measured 0.67–1.68 (median
 * 0.98); the corrupted one measured 0. Two orders of magnitude below the
 * observed floor, because a legitimate photo CAN be anisotropic (vertical fence
 * posts against a plain sky) and paying bytes for one is fine while discarding
 * a good compression for many is not.
 */
export const DEGENERATE_RATIO = 0.01

/**
 * Mean absolute neighbour difference below which the image is simply flat — a
 * solid colour, a blank export. Both axes are ~0 there, so the ratio carries no
 * information and this function must not pretend otherwise.
 */
export const FLAT_DETAIL = 0.5

/**
 * Vertical detail ÷ horizontal detail over an RGBA buffer, or null when the
 * image is too flat (or too small) for the ratio to mean anything.
 *
 * Pure so it can be tested against exact pixel buffers — the browser half of
 * this (decode, draw, read back) is what a real file exercises, and jsdom has
 * no canvas to run it in.
 */
export function detailRatio(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
): number | null {
  if (width < 2 || height < 2) return null
  // Rec. 601 luma, integer weights — this only ever feeds a ratio, so the exact
  // coefficients matter less than using ONE channel that tracks brightness
  // (a per-channel sum would let a colour shift stand in for structure).
  const luma = new Float64Array(width * height)
  for (let i = 0, p = 0; p < luma.length; i += 4, p++) {
    luma[p] = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]
  }

  let horizontal = 0
  let vertical = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x
      if (x + 1 < width) horizontal += Math.abs(luma[p + 1] - luma[p])
      if (y + 1 < height) vertical += Math.abs(luma[p + width] - luma[p])
    }
  }
  const hPairs = (width - 1) * height
  const vPairs = width * (height - 1)
  const h = horizontal / hPairs
  const v = vertical / vPairs

  // A flat image is not evidence of anything. Judged on the horizontal axis
  // because that is the one the observed corruption leaves intact: requiring
  // both would let a broken image (v = 0) read as "flat" and escape.
  if (h < FLAT_DETAIL) return null
  return v / h
}

/** `detailRatio` says nothing is wrong (including when it cannot tell). */
export function ratioLooksIntact(ratio: number | null): boolean {
  return ratio === null || ratio >= DEGENERATE_RATIO
}

/**
 * Draw `file` small and measure it. Best-effort by construction: anything this
 * cannot do — no canvas, an undecodable file, a tainted read — resolves `true`.
 * A check that blocks uploads it failed to perform would be worse than the bug
 * it exists to catch.
 */
export async function looksIntact(file: Blob): Promise<boolean> {
  try {
    if (typeof createImageBitmap !== 'function') return true
    const bitmap = await createImageBitmap(file)
    try {
      const width = Math.min(SAMPLE_WIDTH, bitmap.width)
      const height = Math.max(2, Math.round((bitmap.height / bitmap.width) * width))
      const canvas = makeCanvas(width, height)
      if (!canvas) return true
      const context = canvas.getContext('2d')
      if (!context) return true
      // The default smoothing is what makes the sample honest: it averages the
      // source rather than point-sampling it, so a stripe pattern survives
      // downscaling instead of aliasing into something else.
      context.drawImage(bitmap, 0, 0, width, height)
      const { data } = context.getImageData(0, 0, width, height)
      return ratioLooksIntact(detailRatio(data, width, height))
    } finally {
      bitmap.close()
    }
  } catch {
    return true
  }
}

function makeCanvas(width: number, height: number): OffscreenCanvas | HTMLCanvasElement | null {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(width, height)
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

/**
 * Can this file be uploaded as-is? The fallback path hands the ORIGINAL to the
 * server, and the server's presign ceiling is the GIF one — smaller than the
 * per-type cap a picked photo was validated against, so "the user was allowed
 * to pick it" does not mean "we may send it uncompressed".
 */
export function fitsWithoutCompression(file: Blob): boolean {
  return file.size <= MAX_PRESIGN_BYTES
}
