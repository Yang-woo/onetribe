import { ImageResponse } from 'next/og'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { eventLine, isMomentId, momentImageSrc } from '@/lib/moments'
import { supabaseServerAnon } from '@/lib/supabase/server-anon'

/**
 * Moment Card OG image — docs/12 G: fullbleed photo, bottom gradient to
 * True Warm Black, `city · year · festival`, small wordmark with the
 * orange pulse. This endpoint is why /m/[id] exists (share loop).
 */

// Bundled Space Grotesk (OFL) — no CDN fetch on serverless cold starts,
// where link-unfurler traffic concentrates.
let fontData: Buffer | null | undefined

async function loadFont(): Promise<Buffer | null> {
  if (fontData !== undefined) return fontData
  try {
    fontData = await readFile(fileURLToPath(new URL('./space-grotesk-500.ttf', import.meta.url)))
  } catch {
    fontData = null
  }
  return fontData
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params
  if (!isMomentId(id)) return new Response(null, { status: 404 })

  const { data } = await supabaseServerAnon()
    .from('memories')
    .select('media_url, media_kind, embed_url, events ( festival, year, city )')
    .eq('id', id)
    .maybeSingle()
  if (!data) return new Response(null, { status: 404 })

  const moment = data as unknown as {
    media_url: string | null
    media_kind: 'image' | 'gif' | 'clip'
    embed_url: string | null
    events: { festival: string; year: number; city: string | null } | null
  }
  const src = momentImageSrc({ ...moment, thumb_url: null })
  if (!src) return new Response(null, { status: 404 })

  const line = eventLine(moment.events)
  const font = await loadFont()

  return new ImageResponse(
    <div style={{ display: 'flex', width: '100%', height: '100%', position: 'relative' }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        width={1200}
        height={630}
        style={{ objectFit: 'cover', width: '100%', height: '100%' }}
      />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-end',
          padding: 48,
          backgroundImage: 'linear-gradient(to top, #0B0908 0%, rgba(11,9,8,0) 45%)',
        }}
      >
        {font && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {line && <div style={{ color: '#F2EDE6', fontSize: 40 }}>{line}</div>}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ color: '#A39A90', fontSize: 28 }}>one</div>
              <div style={{ width: 10, height: 26, background: '#FF6A00', borderRadius: 3 }} />
              <div style={{ color: '#A39A90', fontSize: 28 }}>tribe</div>
            </div>
          </div>
        )}
      </div>
    </div>,
    {
      width: 1200,
      height: 630,
      fonts: font
        ? [{ name: 'Space Grotesk', data: font, style: 'normal' as const, weight: 500 as const }]
        : undefined,
    },
  )
}
