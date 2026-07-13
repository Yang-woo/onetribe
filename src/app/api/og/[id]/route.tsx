import { ImageResponse } from 'next/og'
import { youtubeThumbnail } from '@/lib/moments'
import { supabaseServerAnon } from '@/lib/supabase/server-anon'

/**
 * Moment Card OG image — docs/12 G: fullbleed photo, bottom gradient to
 * True Warm Black, `city · year · festival`, small wordmark with the
 * orange pulse. This endpoint is why /m/[id] exists (share loop).
 */

let fontData: ArrayBuffer | null | undefined

async function loadFont(): Promise<ArrayBuffer | null> {
  if (fontData !== undefined) return fontData
  try {
    const res = await fetch(
      'https://cdn.jsdelivr.net/fontsource/fonts/space-grotesk@latest/latin-500-normal.ttf',
    )
    fontData = res.ok ? await res.arrayBuffer() : null
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
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response(null, { status: 404 })

  const { data } = await supabaseServerAnon()
    .from('memories')
    .select('media_url, media_kind, embed_url, events ( festival, year, city )')
    .eq('id', id)
    .maybeSingle()
  if (!data) return new Response(null, { status: 404 })

  const moment = data as unknown as {
    media_url: string | null
    media_kind: string
    embed_url: string | null
    events: { festival: string; year: number; city: string | null } | null
  }
  const src =
    moment.media_kind === 'clip' ? youtubeThumbnail(moment.embed_url ?? '') : moment.media_url
  if (!src) return new Response(null, { status: 404 })

  const event = moment.events
  const line = event ? [event.city, event.year, event.festival].filter(Boolean).join(' · ') : null
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
