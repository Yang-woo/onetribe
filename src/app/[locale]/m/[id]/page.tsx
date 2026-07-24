import { cache, type ReactNode } from 'react'
import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { notFound } from 'next/navigation'
import { CaptionToggle } from '@/components/caption-toggle'
import { JsonLd } from '@/components/json-ld'
import { ReportButton } from '@/components/report-button'
import { SkeletonImage } from '@/components/skeleton-image'
import { Link } from '@/i18n/navigation'
import { countryFlag, countryName } from '@/lib/country'
import { instagramHandle } from '@/lib/format'
import { DEFAULT_LOCALE, isLocale } from '@/lib/locales'
import {
  EVENT_LINE_COLUMNS,
  eventLine,
  isMomentId,
  momentImageSrc,
  PUBLIC_MEMORY_COLUMNS,
  type Moment,
  type MomentEvent,
} from '@/lib/moments'
import { localeAlternates, momentJsonLd } from '@/lib/seo'
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

type MomentWithEvent = Moment & { events: MomentEvent | null }

// cache(): generateMetadata and the page body share one fetch per request.
const fetchMoment = cache(async (id: string): Promise<MomentWithEvent | null> => {
  if (!isMomentId(id)) return null
  const { data } = await supabaseServerAnon()
    .from('memories')
    .select(`${PUBLIC_MEMORY_COLUMNS}, ${EVENT_LINE_COLUMNS}`)
    .eq('id', id)
    .maybeSingle()
  return (data as unknown as MomentWithEvent) ?? null
})

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; id: string }>
}): Promise<Metadata> {
  const { locale, id } = await params
  const moment = await fetchMoment(id)
  if (!moment) return {}
  const base = siteUrl()
  const title = eventLine(moment.events) ?? 'a moment'
  return {
    // The layout template appends the brand — plain title here avoids
    // "… — one tribe — one tribe".
    title,
    description: moment.caption ?? undefined,
    alternates: localeAlternates(`/m/${id}`, isLocale(locale) ? locale : DEFAULT_LOCALE),
    openGraph: {
      siteName: 'one tribe',
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

  // Keyset neighbors: (created_at, id) so batch siblings (same timestamp) are
  // reachable via ←/→ instead of being skipped.
  const db = supabaseServerAnon()
  const [translatedCaption, { data: prevRows }, { data: nextRows }] = await Promise.all([
    translationPromise,
    db
      .from('memories')
      .select('id')
      .or(
        `created_at.lt.${moment.created_at},and(created_at.eq.${moment.created_at},id.lt.${moment.id})`,
      )
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(1),
    db
      .from('memories')
      .select('id')
      .or(
        `created_at.gt.${moment.created_at},and(created_at.eq.${moment.created_at},id.gt.${moment.id})`,
      )
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(1),
  ])
  const prevId = prevRows?.[0]?.id as string | undefined
  const nextId = nextRows?.[0]?.id as string | undefined

  const src = momentImageSrc(moment) ?? undefined
  const jsonLd = momentJsonLd(moment, isLocale(locale) ? locale : DEFAULT_LOCALE)

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-4 py-8">
      {jsonLd && <JsonLd data={jsonLd} />}
      {moment.media_kind === 'clip' && moment.embed_url ? (
        <a href={moment.embed_url} target="_blank" rel="noopener noreferrer">
          {src && (
            <SkeletonImage
              src={src}
              alt={moment.caption ?? 'moment'}
              loading="eager"
              defaultAspectRatio="16 / 9"
              wrapperClassName="w-full"
              className="w-full rounded-lg"
            />
          )}
          <span className="mt-2 block text-sm text-flame">{t('watchOnYoutube')}</span>
        </a>
      ) : (
        src && (
          <SkeletonImage
            src={src}
            alt={moment.caption ?? 'moment'}
            loading="eager"
            aspectRatio={moment.aspect_ratio}
            defaultAspectRatio="3 / 2"
            wrapperClassName="w-full"
            className="w-full rounded-lg"
          />
        )
      )}

      <div className="flex flex-col gap-1">
        {moment.events && <p className="text-sm text-muted">{eventLine(moment.events)}</p>}
        {moment.caption && (
          <CaptionToggle
            original={moment.caption}
            translated={translatedCaption ?? moment.caption}
          />
        )}
        {(() => {
          // Attribution: display name and Instagram handle are DISTINCT fields
          // (docs/00 D30) — the name is a name, the @ belongs on the handle. Plus
          // the origin country (docs/00 D31), which the wall card shows but this
          // page was dropping.
          const handle = instagramHandle(moment.author_link)
          const flag = moment.origin_country ? countryFlag(moment.origin_country) : ''
          const country = moment.origin_country ? countryName(moment.origin_country, locale) : null
          if (!moment.author_name && !handle && !country) return null
          const sep = <span className="text-[#6e655c]">·</span>
          const parts: ReactNode[] = []
          if (moment.author_name)
            parts.push(<span className="text-paper">{moment.author_name}</span>)
          if (handle)
            parts.push(
              <a
                href={moment.author_link!}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="text-flame hover:underline"
              >
                @{handle}
              </a>,
            )
          if (country)
            parts.push(
              <span title={country}>
                {flag ? `${flag} ` : ''}
                {country}
              </span>,
            )
          return (
            <div className="flex flex-wrap items-center gap-1.5 text-sm text-muted">
              {parts.map((part, i) => (
                <span key={i} className="flex items-center gap-1.5">
                  {i > 0 && sep}
                  {part}
                </span>
              ))}
            </div>
          )
        })()}
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
