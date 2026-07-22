import { ImageResponse } from 'next/og'
import { LogoMark } from '@/components/logo'
import {
  EVENT_LINE_COLUMNS,
  eventLine,
  isMomentId,
  momentImageSrc,
  type MomentEvent,
} from '@/lib/moments'
import { supabaseServerAnon } from '@/lib/supabase/server-anon'
import { loadOgFonts } from '../fonts'

/**
 * Moment Card OG image — docs/12 G: fullbleed photo, bottom gradient to
 * True Warm Black, `city · year · festival`, small beam-mark lockup
 * (docs/00 D24). This endpoint is why /m/[id] exists (share loop).
 */

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params
  if (!isMomentId(id)) return new Response(null, { status: 404 })

  const { data } = await supabaseServerAnon()
    .from('memories')
    .select(`media_url, media_kind, embed_url, ${EVENT_LINE_COLUMNS}`)
    .eq('id', id)
    .maybeSingle()
  if (!data) return new Response(null, { status: 404 })

  const moment = data as unknown as {
    media_url: string | null
    media_kind: 'image' | 'gif' | 'clip'
    embed_url: string | null
    events: MomentEvent | null
  }
  // satori (next/og) decodes JPEG/PNG only — webp/animated-gif would throw and
  // blank the card. YouTube thumbs are jpg (safe); drop unsafe uploads to the
  // branded text-only card rather than a broken image.
  const rawSrc = momentImageSrc({ ...moment, thumb_url: null })
  const src = rawSrc && /\.(jpe?g|png)(\?|$)/i.test(rawSrc) ? rawSrc : null

  const line = eventLine(moment.events)
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
      {src && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          width={1200}
          height={630}
          style={{ objectFit: 'cover', width: '100%', height: '100%' }}
        />
      )}
      <div
        style={{
          position: 'absolute',
          // explicit sides — satori does not expand the `inset` shorthand,
          // so this whole overlay (gradient + event line + wordmark) was
          // zero-sized and never rendered (docs/00 D23 og card fix)
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-end',
          padding: 48,
          backgroundImage: 'linear-gradient(to top, #0B0908 0%, rgba(11,9,8,0) 45%)',
        }}
      >
        {fonts.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {line && <div style={{ color: '#F2EDE6', fontSize: 40 }}>{line}</div>}
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <LogoMark width={45} height={30} />
              <div style={{ color: '#F2EDE6', fontSize: 22, fontWeight: 700, letterSpacing: 4 }}>
                ONE TRIBE
              </div>
            </div>
          </div>
        )}
      </div>
    </div>,
    {
      width: 1200,
      height: 630,
      fonts: fonts.length ? fonts : undefined,
    },
  )
}
