/**
 * Did the canvas draw a picture, or garbage? — docs/00 D56.
 *
 * A photo that came in through the Reddit launch landed on the wall as a column
 * of vertical stripes. Pulled apart afterwards, the stored 2400×1800 file has
 * exactly ONE distinct row repeated 1800 times, while all 2399 column pairs
 * differ: the pixel buffer went into the canvas misaligned. R2 answered 200, the
 * row was valid, the thumbnail was made from that same output so it broke too,
 * and the server never looks at what a picture contains — so nothing anywhere
 * noticed. The same person's next upload two minutes later was fine, which makes
 * this an intermittent decode failure inside the client compression step rather
 * than a broken file.
 *
 * The tell is that the corruption is *structured*: one axis carries no
 * information at all while the other still does. A flatness test (standard
 * deviation) does not catch it — the reported photo measured sd=22, an ordinary
 * looking photograph. Neither does file size, which was the first thing tried
 * after this shipped: the broken photo encodes to 1.85 bits per pixel, ABOVE the
 * 1.10 median of the 220 real photos on the wall, because vertical stripes are
 * horizontally high-frequency and JPEG spends more bits on them, not fewer.
 *
 * Both axes are judged, not just one. The compressor transposes the image when
 * it applies EXIF orientation itself (`followExifOrientation` swaps width and
 * height for orientations 5–8, and orientation 6 is an ordinary portrait phone
 * photo), so the same misalignment can just as well come out as identical
 * COLUMNS. Measured: a vertical gradient — the transposed shape — passes a
 * one-axis test and fails this one.
 */

/**
 * Width the sample is drawn at. Small enough to be free, big enough to have
 * structure — the ratio below is scale-invariant, not a pixel comparison.
 */
export const SAMPLE_WIDTH = 64

/**
 * Below this, both axes are so quiet that their ratio is noise — a solid colour,
 * a blank export, a near-black night sky. Judged on the BUSIER axis: requiring
 * both to clear it would let a broken image (one axis at 0) read as "flat" and
 * escape, which is the hole a one-sided version of this check had.
 */
export const FLAT_DETAIL = 0.5

/**
 * Below this, one axis has effectively vanished while the other survives — the
 * signature above.
 *
 * Measured against the population it actually runs on rather than against
 * invented images: the shipped function, bundled and run in Chromium and WebKit
 * over all 221 photos on the production wall, scored the 220 good ones between
 * 0.58 and 1.72 (median 0.93) and the broken one at 0. Not one of them came
 * within 58× of this number, and none fell through the flatness escape either.
 *
 * Synthetic graphics are a different story and the number does not pretend
 * otherwise: a noiseless vertical-beam render, or a pure horizontal gradient,
 * scores exactly 0 — because their rows really ARE identical, which no test can
 * tell apart from rows a bug made identical. That costs a wasted re-encode and
 * nothing else (see prepareForUpload), which is what allows a threshold this
 * decisive. Add a little sensor noise — a photograph of a striped fence — and
 * the same shape scores 0.066.
 */
export const DEGENERATE_RATIO = 0.01

/**
 * Detail on the quieter axis ÷ detail on the busier one, or null when the image
 * is too flat (or too small) for the ratio to mean anything.
 *
 * Pure so it can be tested against exact pixel buffers — the browser half of
 * this (decode, draw, read back) is what a real file exercises, and jsdom has no
 * canvas to run it in.
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
  const h = horizontal / ((width - 1) * height)
  const v = vertical / (width * (height - 1))

  const busier = Math.max(h, v)
  if (busier < FLAT_DETAIL) return null
  return Math.min(h, v) / busier
}

/** `detailRatio` says nothing is wrong (including when it cannot tell). */
export function ratioLooksIntact(ratio: number | null): boolean {
  return ratio === null || ratio >= DEGENERATE_RATIO
}

/**
 * Draw `file` small and measure it. Best-effort by construction: anything this
 * cannot do — no canvas, an undecodable file, a tainted read — resolves `true`.
 * A check that blocked uploads it failed to perform would be worse than the bug
 * it exists to catch.
 *
 * That default is also why the e2e asserts the sample was actually TAKEN: every
 * "intact" here is either a measurement or a shrug, and the two look identical
 * from the outside.
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
      // downscaling instead of aliasing into something else. Verified on the
      // real artifact in Chromium, WebKit and Firefox — all three keep the
      // signal (the axis reads 0 in every one of them).
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
