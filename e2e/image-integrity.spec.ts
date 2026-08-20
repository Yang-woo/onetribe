import { expect, test } from '@playwright/test'
import {
  DEGENERATE_RATIO,
  detailRatio,
  ratioLooksIntact,
  SAMPLE_WIDTH,
} from '../src/lib/upload/image-integrity'

/**
 * The browser half of the corruption detector — docs/00 D56.
 *
 * jsdom has no canvas, so the unit tests reach only the pure ratio over
 * hand-built buffers. The half that matters in production — a real file
 * decoded by a real image decoder, drawn small through a real smoothing
 * filter, read back — needs a real graphics stack.
 *
 * The split here is deliberate: the browser produces the PIXELS, and the
 * SHIPPED `detailRatio` judges them, back in Node. Re-implementing the
 * algorithm inside `page.evaluate` would test a copy — it could stay green
 * while the real one drifted underneath it, which is the failure mode this
 * whole feature exists to prevent (docs/00 D47/D49: verify media with real
 * files, not with option assertions).
 */

/**
 * Encode a real PNG in the browser and hand back the pixels a downscale of it
 * produces — the same decode → drawImage → getImageData path `looksIntact`
 * runs. `broken` repeats row 0 down the image, which is what the reported
 * corruption did.
 */
async function sampledPixels(
  page: import('@playwright/test').Page,
  broken: boolean,
  sampleWidth: number,
) {
  return page.evaluate(
    async ({ broken, sampleWidth }) => {
      const w = 240
      const h = 180
      const source = document.createElement('canvas')
      source.width = w
      source.height = h
      const sctx = source.getContext('2d')!
      const img = sctx.createImageData(w, h)
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const v = broken
            ? 128 + 31 * Math.sin(x / 2.5) + ((x * 11) % 13)
            : 128 + 60 * Math.sin(x / 9) + 40 * Math.cos(y / 7) + ((x * 7 + y * 13) % 17)
          const i = (y * w + x) * 4
          img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.max(0, Math.min(255, v))
          img.data[i + 3] = 255
        }
      }
      sctx.putImageData(img, 0, 0)
      const file: Blob = await new Promise((res) => source.toBlob((b) => res(b!), 'image/png'))

      // from here on: exactly what looksIntact does with a File
      const bitmap = await createImageBitmap(file)
      const width = Math.min(sampleWidth, bitmap.width)
      const height = Math.max(2, Math.round((bitmap.height / bitmap.width) * width))
      const canvas = new OffscreenCanvas(width, height)
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(bitmap, 0, 0, width, height)
      const { data } = ctx.getImageData(0, 0, width, height)
      bitmap.close()
      return { pixels: Array.from(data), width, height }
    },
    { broken, sampleWidth },
  )
}

test('the shipped detector judges real decoded pixels correctly', async ({ page }) => {
  await page.goto('/en/upload')

  const healthy = await sampledPixels(page, false, SAMPLE_WIDTH)
  const corrupt = await sampledPixels(page, true, SAMPLE_WIDTH)

  const healthyRatio = detailRatio(
    new Uint8ClampedArray(healthy.pixels),
    healthy.width,
    healthy.height,
  )
  const corruptRatio = detailRatio(
    new Uint8ClampedArray(corrupt.pixels),
    corrupt.width,
    corrupt.height,
  )

  // A real photograph survives the round trip. This is the assertion the pure
  // test cannot make: PNG encoding and the downscale smoothing filter could
  // have flattened one axis, which would condemn every upload on the site.
  expect(healthyRatio).not.toBeNull()
  expect(healthyRatio!).toBeGreaterThan(DEGENERATE_RATIO)
  expect(ratioLooksIntact(healthyRatio)).toBe(true)

  // And the corruption is still legible as corruption afterwards — the
  // encoder, the decoder and the smoothing filter all preserve it rather than
  // blurring the repeated rows into apparent detail.
  expect(corruptRatio).not.toBeNull()
  expect(corruptRatio!).toBeLessThan(DEGENERATE_RATIO)
  expect(ratioLooksIntact(corruptRatio)).toBe(false)
})
