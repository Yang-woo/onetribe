import { ImageResponse } from 'next/og'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

/**
 * Site-wide OG card (docs/00 D23) — the face of every home/link share:
 * True Warm Black, the hero's orange glow, the wordmark with the pulse bar.
 * Static English brand line — locale-agnostic like the wordmark itself.
 */

// Bundled Space Grotesk (OFL), shared with the moment card — no CDN fetch
// on serverless cold starts, where link-unfurler traffic concentrates.
let fontData: Buffer | null | undefined

async function loadFont(): Promise<Buffer | null> {
  if (fontData !== undefined) return fontData
  try {
    fontData = await readFile(fileURLToPath(new URL('../space-grotesk-500.ttf', import.meta.url)))
  } catch {
    fontData = null
  }
  return fontData
}

export async function GET(): Promise<Response> {
  const font = await loadFont()

  return new ImageResponse(
    <div
      style={{
        display: 'flex',
        width: '100%',
        height: '100%',
        position: 'relative',
        background: '#0B0908',
      }}
    >
      <div
        style={{
          position: 'absolute',
          // explicit sides — satori does not expand the `inset` shorthand,
          // leaving the div zero-sized (docs/00 D23 og card fix)
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          backgroundImage: 'linear-gradient(to top, rgba(255,106,0,0.20) 0%, rgba(11,9,8,0) 45%)',
        }}
      />
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          gap: 28,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 26 }}>
          <div style={{ color: '#F2EDE6', fontSize: 108 }}>one</div>
          <div style={{ width: 30, height: 88, background: '#FF6A00', borderRadius: 8 }} />
          <div style={{ color: '#F2EDE6', fontSize: 108 }}>tribe</div>
        </div>
        <div style={{ color: '#A39A90', fontSize: 38 }}>The moments we took home.</div>
        <div style={{ color: '#FF6A00', fontSize: 27, marginTop: 10 }}>onetribe.world</div>
      </div>
    </div>,
    {
      width: 1200,
      height: 630,
      fonts: font
        ? [{ name: 'Space Grotesk', data: font, style: 'normal' as const, weight: 500 as const }]
        : undefined,
      headers: { 'Cache-Control': 'public, max-age=86400' },
    },
  )
}
