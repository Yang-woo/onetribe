import type { Metadata } from 'next'
import { Suspense } from 'react'
import { getLocale, getTranslations } from 'next-intl/server'
import { BrowseWallButton } from '@/components/browse-wall-button'
import { MemoryWall } from '@/components/memory-wall'
import { WallFilter } from '@/components/wall-filter'
import { WallSkeleton } from '@/components/wall-skeleton'
import { JsonLd } from '@/components/json-ld'
import { Link } from '@/i18n/navigation'
import { isLocale } from '@/lib/locales'
import { fetchMoments, parseEditionYear, wallFilterFor, type EditionChip } from '@/lib/moments'
import { getCachedCounters, getCachedEditions } from '@/lib/moments-cache'
import { localeAlternates, websiteJsonLd } from '@/lib/seo'
import { supabaseServerAnon } from '@/lib/supabase/server-anon'

// Landing + wall in one page — the wall must feel alive on first paint
// (docs/15 §1). Reads go through the ANON client: RLS is the filter.
// The shell (hero + chips) renders from cached editions/counters; only the
// moments query stays dynamic, and it streams inside a Suspense boundary with
// a skeleton. This first render is the SSR/deep-link/crawler path — after
// hydration WallFilter takes chip clicks over and filters in the browser
// (docs/00 D12, D13).
export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  if (!isLocale(locale)) return {}
  return { alternates: localeAlternates('/', locale) }
}

/** Dynamic part — the filtered moments. Streams in behind <Suspense>. */
async function WallSection({
  selectedYear,
  editions,
}: {
  selectedYear: number | null
  editions: EditionChip[]
}) {
  const db = supabaseServerAnon()
  const { eventIds, filterEdition, editionById } = wallFilterFor(editions, selectedYear)
  // fetchMoments ignores an absent/empty eventIds itself — no branching needed
  const moments = await fetchMoments(db, { eventIds })

  return (
    <MemoryWall
      initialMoments={moments}
      eventIds={eventIds}
      filterEdition={filterEdition}
      editionById={editionById}
    />
  )
}

export default async function Home({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  const t = await getTranslations('hero')
  const locale = await getLocale()
  const { e } = await searchParams
  const selectedYear = parseEditionYear(e)

  // Shell data — cached and not filter-specific, so the hero and chips paint
  // without waiting on the DB (docs/00 D12 B).
  const [editions, counters] = await Promise.all([getCachedEditions(), getCachedCounters()])

  return (
    <main className="flex-1">
      <JsonLd data={websiteJsonLd(t('body'))} />
      <section className="relative isolate mx-auto flex max-w-[960px] flex-col items-center gap-7 px-6 pb-[72px] pt-[88px] text-center">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-[420px]"
          style={{
            background:
              'radial-gradient(60% 100% at 50% 100%, rgba(255,106,0,0.14), transparent 70%)',
          }}
        />

        {/* Magazine dateline — an editorial kicker, not a status pill: no
            container, no pulse, no count dependency (design 2026-07-23). */}
        <span className="inline-flex items-center gap-3.5 font-mono text-[11.5px] uppercase tracking-[0.28em] text-muted">
          {t('dateline')}
          <span aria-hidden="true" className="h-px w-[22px] bg-[rgba(163,154,144,0.4)]" />
          <span className="text-paper">{t('datelineScope')}</span>
        </span>

        <h1 className="text-balance font-display text-[clamp(44px,7vw,84px)] font-bold leading-[1.04] tracking-[-0.035em]">
          {t('title')}
        </h1>

        <p className="bg-fire bg-clip-text font-display text-[28px] font-medium leading-[1.3] tracking-[-0.01em] text-transparent">
          {t('subtitle')}
        </p>

        <p className="max-w-[560px] text-base leading-[1.55] text-muted [text-wrap:pretty]">
          {t('body')}
        </p>

        <div className="flex flex-wrap items-center justify-center gap-4">
          <Link
            href="/upload"
            className="rounded-full bg-orange px-8 py-4 text-[17px] font-semibold text-black shadow-[0_0_48px_rgba(255,106,0,0.35)] transition-opacity hover:opacity-90"
          >
            {t('cta')}
          </Link>
          <BrowseWallButton
            targetId="wall"
            className="rounded-full border border-[rgba(163,154,144,0.3)] px-7 py-4 text-base text-paper transition-colors hover:border-[rgba(163,154,144,0.6)]"
          >
            {t('browseWall')}
          </BrowseWallButton>
        </div>

        <p className="text-[15px] text-muted">
          <span className="font-display text-xl font-bold text-orange">
            {counters.moments.toLocaleString(locale)}
          </span>
          {t('counterMoments', { moments: counters.moments })}
          <span> · </span>
          <span className="font-display text-xl font-bold text-orange">
            {counters.countries.toLocaleString(locale)}
          </span>
          {t('counterCountries', { countries: counters.countries })}
        </p>
      </section>

      <div id="wall" className="mx-auto max-w-6xl scroll-mt-16">
        <WallFilter editions={editions} initialSelectedYear={selectedYear}>
          <Suspense key={selectedYear ?? 'all'} fallback={<WallSkeleton />}>
            <WallSection selectedYear={selectedYear} editions={editions} />
          </Suspense>
        </WallFilter>
      </div>
    </main>
  )
}
