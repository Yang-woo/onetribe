import { cache } from 'react'
import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { notFound } from 'next/navigation'
import { CaptionToggle } from '@/components/caption-toggle'
import { ReportButton } from '@/components/report-button'
import { Link } from '@/i18n/navigation'
import {
  eventLine,
  isMomentId,
  momentImageSrc,
  PUBLIC_MEMORY_COLUMNS,
  type Moment,
} from '@/lib/moments'
import { localeAlternates } from '@/lib/seo'
import { siteUrl } from '@/lib/site-url'
import { createServiceRoleClient } from '@/lib/server/supabase'
import { supabaseServerAnon } from '@/lib/supabase/server-anon'
import { createDefaultProvider, translateWithCache } from '@/lib/translate'

/**
 * Moment Card — docs/17 T3.4, docs/15 §3. The shareable unit of the whole
 * project: fullbleed photo, translated caption with an original toggle,
 * OG image, prev/next, report + takedown entry points. Hidden or unknown
 * ids 404 via RLS (the anon read finds nothing).
 */
export const dynamic = 'force-dynamic'

type MomentWithEvent = Moment & {
  events: { festival: string; edition: string | null; year: number; city: string | null } | null
}

// cache(): generateMetadata and the page body share one fetch per request.
const fetchMoment = cache(async (id: string): Promise<MomentWithEvent | null> => {
  if (!isMomentId(id)) return null
  const { data } = await supabaseServerAnon()
    .from('memories')
    .select(`${PUBLIC_MEMORY_COLUMNS}, events ( festival, edition, year, city )`)
    .eq('id', id)
    .maybeSingle()
  return (data as unknown as MomentWithEvent) ?? null
})

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; id: string }>
}): Promise<Metadata> {
  const { id } = await params
  const moment = await fetchMoment(id)
  if (!moment) return {}
  const base = siteUrl()
  const title = eventLine(moment.events) ?? 'a moment'
  return {
    title: `${title} — one tribe`,
    description: moment.caption ?? undefined,
    alternates: localeAlternates(`/m/${id}`),
    openGraph: {
      title: `${title} — one tribe`,
      description: moment.caption ?? undefined,
      images: [{ url: `${base}/api/og/${id}`, width: 1200, height: 630 }],
    },
  }
}

export default async function MomentPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>
}) {
  const { locale, id } = await params
  const moment = await fetchMoment(id)
  if (!moment) notFound()
  const t = await getTranslations('moment')

  // On-view caption translation (docs/16) runs concurrently with the
  // independent prev/next lookups — a translation-cache miss must not
  // delay neighbor navigation.
  const provider = createDefaultProvider()
  const translationPromise =
    moment.caption && provider && moment.source_lang !== locale
      ? translateWithCache(
          createServiceRoleClient(),
          provider,
          moment.caption,
          locale,
          moment.source_lang,
        ).then((outcome) => outcome.text)
      : Promise.resolve(moment.caption)

  const db = supabaseServerAnon()
  const [translatedCaption, { data: prevRows }, { data: nextRows }] = await Promise.all([
    translationPromise,
    db
      .from('memories')
      .select('id')
      .lt('created_at', moment.created_at)
      .order('created_at', { ascending: false })
      .limit(1),
    db
      .from('memories')
      .select('id')
      .gt('created_at', moment.created_at)
      .order('created_at', { ascending: true })
      .limit(1),
  ])
  const prevId = prevRows?.[0]?.id as string | undefined
  const nextId = nextRows?.[0]?.id as string | undefined

  const src = momentImageSrc(moment) ?? undefined

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-4 py-8">
      {moment.media_kind === 'clip' && moment.embed_url ? (
        <a href={moment.embed_url} target="_blank" rel="noopener noreferrer">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {src && <img src={src} alt={moment.caption ?? 'moment'} className="w-full rounded-lg" />}
          <span className="mt-2 block text-sm text-flame">{t('watchOnYoutube')}</span>
        </a>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        src && <img src={src} alt={moment.caption ?? 'moment'} className="w-full rounded-lg" />
      )}

      <div className="flex flex-col gap-1">
        {moment.events && <p className="text-sm text-muted">{eventLine(moment.events)}</p>}
        {moment.caption && (
          <CaptionToggle
            original={moment.caption}
            translated={translatedCaption ?? moment.caption}
          />
        )}
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

      <div className="flex items-center justify-between">
        {prevId ? (
          <Link
            href={`/m/${prevId}`}
            aria-label={t('previous')}
            className="text-muted hover:text-paper"
          >
            ←
          </Link>
        ) : (
          <span />
        )}
        {nextId ? (
          <Link
            href={`/m/${nextId}`}
            aria-label={t('next')}
            className="text-muted hover:text-paper"
          >
            →
          </Link>
        ) : (
          <span />
        )}
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-line pt-4">
        <Link href="/" className="text-sm text-muted hover:text-paper">
          {t('backToWall')}
        </Link>
        <div className="flex items-center gap-4">
          <ReportButton memoryId={moment.id} />
          <Link href="/takedown" className="text-sm text-muted hover:text-paper">
            {t('takedownLink')}
          </Link>
        </div>
      </div>
    </main>
  )
}
