import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

/**
 * Bundled Space Grotesk (OFL), shared by both OG cards — no CDN fetch on
 * serverless cold starts, where link-unfurler traffic concentrates.
 * 500 = body/event line, 700 = ONE TRIBE wordmark (docs/12-brand C, D24).
 */

type OgFont = { name: string; data: Buffer; style: 'normal'; weight: 500 | 700 }

const FILES = [
  [500, 'space-grotesk-500.ttf'],
  [700, 'space-grotesk-700.ttf'],
] as const

let cached: OgFont[] | undefined

export async function loadOgFonts(): Promise<OgFont[]> {
  if (cached) return cached
  const entries = await Promise.all(
    FILES.map(async ([weight, file]) => {
      try {
        const data = await readFile(fileURLToPath(new URL(`./${file}`, import.meta.url)))
        return { name: 'Space Grotesk', data, style: 'normal' as const, weight }
      } catch {
        return null
      }
    }),
  )
  const fonts = entries.filter((e) => e !== null)
  // Only memoize a COMPLETE load. A transient readFile failure would otherwise
  // pin an empty (or partial) array forever on this serverless instance, so
  // every later OG card would render text-less (moment cards gate on
  // fonts.length > 0) with no retry.
  if (fonts.length === FILES.length) cached = fonts
  return fonts
}
