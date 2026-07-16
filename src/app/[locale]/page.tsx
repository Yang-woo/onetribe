import type { Metadata } from 'next'
import { getLocale, getTranslations } from 'next-intl/server'
import { BrowseWallButton } from '@/components/browse-wall-button'
import { EditionChips } from '@/components/edition-chips'
import { MemoryWall } from '@/components/memory-wall'
import { PulseDot } from '@/components/pulse-dot'
import { Link } from '@/i18n/navigation'
import { fetchCounters, fetchEditions, fetchMoments } from '@/lib/moments'
import { localeAlternates } from '@/lib/seo'
import { supabaseServerAnon } from '@/lib/supabase/server-anon'

// Landing + wall in one page — the wall must feel alive on first paint
// (docs/15 §1). Reads go through the ANON client: RLS is the filter.
export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  return { alternates: localeAlternates('/') }
}

export default async function Home({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  const t = await getTranslations('hero')
  const locale = await getLocale()
  const db = supabaseServerAnon()
  const { e } = await searchParams
  const selectedYear = e && /^\d{4}$/.test(e) ? Number(e) : null

  // All first-paint reads start together; moments only chain behind
  // editions when a year filter needs their ids.
  const editionsPromise = fetchEditions(db)
  const momentsPromise = selectedYear
    ? editionsPromise.then((editions) =>
        fetchMoments(db, {
          eventIds: editions.filter((ed) => ed.year === selectedYear).map((ed) => ed.id),
        }),
      )
    : fetchMoments(db)
  const [editions, moments, counters] = await Promise.all([
    editionsPromise,
    momentsPromise,
    fetchCounters(db),
  ])
  const selectedEventIds = selectedYear
    ? editions.filter((ed) => ed.year === selectedYear).map((ed) => ed.id)
    : undefined
  const filterEdition = selectedYear
    ? editions.find((ed) => ed.year === selectedYear)
    : undefined
  const editionById = new Map(editions.map((ed) => [ed.id, ed]))

  return (
    <main className="flex-1">
      <section className="relative isolate mx-auto flex max-w-[960px] flex-col items-center gap-7 px-6 pb-[72px] pt-[88px] text-center">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-[420px]"
          style={{
            background: 'radial-gradient(60% 100% at 50% 100%, rgba(255,106,0,0.14), transparent 70%)',
          }}
        />

        <span className="inline-flex items-center gap-2 rounded-full border border-[rgba(255,106,0,0.35)] px-3.5 py-1.5 text-[13px] text-flame">
          <PulseDot />
          {t('liveBadge', { countries: counters.countries })}
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
        <EditionChips editions={editions} selectedYear={selectedYear} />
        <MemoryWall
          key={selectedYear ?? 'all'}
          initialMoments={moments}
          eventIds={selectedEventIds}
          filterEdition={filterEdition}
          editionById={editionById}
        />
      </div>
    </main>
  )
}
