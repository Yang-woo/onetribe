import { ImageResponse } from 'next/og'
import { LogoMark } from '@/components/logo'
import { loadOgFonts } from '../fonts'

/**
 * Site-wide OG card (docs/00 D23) — the face of every home/link share:
 * True Warm Black, the hero's orange glow, the primary vertical lockup
 * (searchlight beam mark + ONE TRIBE wordmark, docs/00 D24).
 * Static English brand line — locale-agnostic like the wordmark itself.
 */

export async function GET(): Promise<Response> {
  const fonts = await loadOgFonts()

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
          gap: 26,
        }}
      >
        <LogoMark width={195} height={130} />
        <div
          style={{
            color: '#F2EDE6',
            fontSize: 72,
            fontWeight: 700,
            letterSpacing: 13,
            // letter-spacing trails the last glyph — offset to keep optical center
            paddingLeft: 13,
          }}
        >
          ONE TRIBE
        </div>
        <div style={{ color: '#A39A90', fontSize: 38 }}>The moments we took home.</div>
        <div style={{ color: '#FF6A00', fontSize: 27, marginTop: 6 }}>onetribe.world</div>
      </div>
    </div>,
    {
      width: 1200,
      height: 630,
      fonts: fonts.length ? fonts : undefined,
      headers: { 'Cache-Control': 'public, max-age=86400' },
    },
  )
}
