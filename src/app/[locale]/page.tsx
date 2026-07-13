import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { EditionChips } from '@/components/edition-chips'
import { MemoryWall } from '@/components/memory-wall'
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

  return (
    <main className="flex-1">
      <section className="mx-auto flex max-w-3xl flex-col items-center gap-5 px-4 pb-10 pt-16 text-center">
        <h1 className="font-display text-4xl leading-tight tracking-tight md:text-5xl">
          {t('title')}
        </h1>
        <p className="max-w-xl text-muted">{t('body')}</p>
        <Link
          href="/upload"
          className="rounded-full bg-orange px-6 py-3 font-medium text-black transition-opacity hover:opacity-90"
        >
          {t('cta')}
        </Link>
        <p className="text-sm text-orange">
          {t('counter', { moments: counters.moments, countries: counters.countries })}
        </p>
      </section>

      <div className="mx-auto max-w-6xl">
        <EditionChips editions={editions} selectedYear={selectedYear} />
        <MemoryWall
          key={selectedYear ?? 'all'}
          initialMoments={moments}
          eventIds={selectedEventIds}
        />
      </div>
    </main>
  )
}
