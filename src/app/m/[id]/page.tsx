import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ReportButton } from '@/components/report-button'
import { PUBLIC_MEMORY_COLUMNS, youtubeThumbnail, type Moment } from '@/lib/moments'
import { supabaseServerAnon } from '@/lib/supabase/server-anon'

/**
 * Moment page — minimal W2 version (photo, meta, report/takedown entry
 * points). OG image, translated captions and prev/next arrive with W3
 * T3.4. Hidden or unknown ids 404 via RLS: the anon read simply finds
 * nothing.
 */
export const dynamic = 'force-dynamic'

export default async function MomentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound()

  const db = supabaseServerAnon()
  const { data } = await db
    .from('memories')
    .select(`${PUBLIC_MEMORY_COLUMNS}, events ( festival, edition, year, city )`)
    .eq('id', id)
    .maybeSingle()
  if (!data) notFound()

  const moment = data as unknown as Moment & {
    events: { festival: string; edition: string | null; year: number; city: string | null } | null
  }
  const event = moment.events
  const src =
    moment.media_kind === 'clip'
      ? (youtubeThumbnail(moment.embed_url ?? '') ?? undefined)
      : (moment.media_url ?? undefined)

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-4 py-8">
      {moment.media_kind === 'clip' && moment.embed_url ? (
        <a href={moment.embed_url} target="_blank" rel="noopener noreferrer">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {src && <img src={src} alt={moment.caption ?? 'moment'} className="w-full rounded-lg" />}
          <span className="mt-2 block text-sm text-flame">watch on YouTube ↗</span>
        </a>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        src && <img src={src} alt={moment.caption ?? 'moment'} className="w-full rounded-lg" />
      )}

      <div className="flex flex-col gap-1">
        {event && (
          <p className="text-sm text-muted">
            {[event.city, event.year, event.festival].filter(Boolean).join(' · ')}
            {event.edition ? ` — ${event.edition}` : ''}
          </p>
        )}
        {moment.caption && <p className="text-lg">{moment.caption}</p>}
        {moment.author_name &&
          (moment.author_link ? (
            <a
              href={moment.author_link}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-flame hover:underline"
            >
              @{moment.author_name}
            </a>
          ) : (
            <p className="text-sm text-muted">@{moment.author_name}</p>
          ))}
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-line pt-4">
        <Link href="/" className="text-sm text-muted hover:text-paper">
          ← back to the wall
        </Link>
        <div className="flex items-center gap-4">
          <ReportButton memoryId={moment.id} />
          <Link href="/takedown" className="text-sm text-muted hover:text-paper">
            takedown
          </Link>
        </div>
      </div>
    </main>
  )
}
