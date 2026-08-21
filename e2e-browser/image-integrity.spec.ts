import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import ts from 'typescript'

/**
 * The corruption detector, end to end — docs/00 D56.
 *
 * The version of this that shipped and was pulled had no test that ran
 * `looksIntact` at all: replacing its body with `return true` left the whole
 * suite green. Its e2e reimplemented the decode-and-sample inside
 * `page.evaluate` and only checked the arithmetic in Node — a copy that stays
 * green while the real code drifts, which is the exact failure this feature
 * exists to prevent.
 *
 * So this loads the SHIPPED module into a real browser and calls it. The module
 * has no imports, so `tsc` alone turns it into something a page can run; if that
 * ever stops being true the transpile below will emit a `require` and the first
 * assertion will fail loudly rather than quietly testing nothing.
 */

// The path is relative to the repo root, which is where both `yarn test:browser`
// and CI run from. A wrong one throws here rather than quietly testing nothing.
function shippedModuleScript(): string {
  const source = readFileSync('src/lib/upload/image-integrity.ts', 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  })
  // Both spellings: `import()` survives transpilation to CommonJS under some
  // target/helper combinations, so screening only for `require` would let a
  // module that no longer loads slip through as a test that proves nothing.
  if (/\b(require|import)\s*\(/.test(outputText)) {
    throw new Error('image-integrity.ts grew an import — this harness can no longer load it')
  }
  return `window.II = (function () { const exports = {}; ${outputText}; return exports })()`
}

/** Shapes measured off the real artifact and its neighbours on the wall. */
const CASES = ['normal', 'rowRepeat', 'colRepeat', 'flat'] as const

test('the shipped check judges real encoded files in a real browser', async ({ page }) => {
  // about:blank on purpose: this module has no imports and no DOM of its own,
  // so binding it to the app would make a pure-logic test fail whenever the
  // wall does — and would keep it out of the job that gates pull requests,
  // which is where the only coverage of this function's body needs to live.
  await page.goto('about:blank')
  await page.addScriptTag({ content: shippedModuleScript() })

  const results = await page.evaluate(async (cases) => {
    // Watch what the shipped function actually reads. `looksIntact` answers
    // "true" for anything it could not do, so an untaken sample and a healthy
    // photo are indistinguishable from the outside — and a harness that cannot
    // tell them apart proves nothing.
    const seen: ImageData[] = []
    for (const proto of [
      CanvasRenderingContext2D.prototype,
      typeof OffscreenCanvasRenderingContext2D !== 'undefined'
        ? OffscreenCanvasRenderingContext2D.prototype
        : null,
    ]) {
      if (!proto) continue
      const original = proto.getImageData
      proto.getImageData = function (...args: Parameters<typeof original>) {
        const data = original.apply(this, args)
        seen.push(data)
        return data
      }
    }

    // A genuine JPEG, encoded and decoded by the browser — not a pixel array
    // handed straight to the arithmetic.
    async function encode(kind: string): Promise<Blob> {
      const w = 480
      const h = 360
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')!
      const img = ctx.createImageData(w, h)
      const luma = (x: number, y: number) => ((x * 73 + y * 149) % 97) * 2.6
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let v: number
          if (kind === 'normal') v = luma(x, y)
          // one distinct row repeated — what the stored broken photo is
          else if (kind === 'rowRepeat') v = luma(x, 0)
          // the same misalignment after the compressor's own EXIF transpose
          else if (kind === 'colRepeat') v = luma(0, y)
          else v = 40
          const i = (y * w + x) * 4
          img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.max(0, Math.min(255, v))
          img.data[i + 3] = 255
        }
      }
      ctx.putImageData(img, 0, 0)
      return await new Promise<Blob>((resolve) =>
        canvas.toBlob((b) => resolve(b!), 'image/jpeg', 0.95),
      )
    }

    const out: Record<string, { intact: boolean; sampled: boolean; ratio: number | null }> = {}
    for (const kind of cases) {
      seen.length = 0
      const blob = await encode(kind)
      const intact = await window.II.looksIntact(blob)
      const sample = seen[0]
      out[kind] = {
        intact,
        sampled: !!sample,
        ratio: sample ? window.II.detailRatio(sample.data, sample.width, sample.height) : null,
      }
    }
    return out
  }, CASES)

  // Every verdict below has to be a measurement, not the best-effort shrug.
  for (const kind of CASES) {
    expect(results[kind].sampled, `${kind} was never sampled`).toBe(true)
  }

  // A photograph goes through untouched — no wasted re-encode on the happy path.
  expect(results.normal.intact).toBe(true)
  expect(results.normal.ratio!).toBeGreaterThan(0.5)

  // Both degenerate axes are caught. colRepeat is the one a single-axis test
  // let through, and the compressor can produce it whenever it applies EXIF
  // orientation itself (5–8, i.e. an ordinary portrait phone photo).
  expect(results.rowRepeat.intact).toBe(false)
  expect(results.colRepeat.intact).toBe(false)
  expect(results.rowRepeat.ratio!).toBeLessThan(0.01)
  expect(results.colRepeat.ratio!).toBeLessThan(0.01)

  // A flat frame is not evidence of anything — "cannot tell" must read as fine,
  // or every near-black night sky pays for a pointless second compression.
  expect(results.flat.ratio).toBeNull()
  expect(results.flat.intact).toBe(true)
})

declare global {
  interface Window {
    II: typeof import('../src/lib/upload/image-integrity')
  }
}
