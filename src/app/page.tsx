import Link from 'next/link'
import { EditionChips } from '@/components/edition-chips'
import { MemoryWall } from '@/components/memory-wall'
import { copy } from '@/lib/copy'
import { fetchCounters, fetchEditions, fetchMoments } from '@/lib/moments'
import { supabaseServerAnon } from '@/lib/supabase/server-anon'

// Landing + wall in one page — the wall must feel alive on first paint
// (docs/15 §1). Reads go through the ANON client: RLS is the filter.
export const dynamic = 'force-dynamic'

export default async function Home({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  const db = supabaseServerAnon()
  const { e } = await searchParams
  const selectedYear = e && /^\d{4}$/.test(e) ? Number(e) : null

  const editions = await fetchEditions(db)
  const selectedEventIds = selectedYear
    ? editions.filter((ed) => ed.year === selectedYear).map((ed) => ed.id)
    : undefined

  const [moments, counters] = await Promise.all([
    fetchMoments(db, { eventIds: selectedEventIds }),
    fetchCounters(db),
  ])

  return (
    <main className="flex-1">
      <section className="mx-auto flex max-w-3xl flex-col items-center gap-5 px-4 pb-10 pt-16 text-center">
        <h1 className="font-display text-4xl leading-tight tracking-tight md:text-5xl">
          {copy.hero.title}
        </h1>
        <p className="max-w-xl text-muted">{copy.hero.body}</p>
        <Link
          href="/upload"
          className="rounded-full bg-orange px-6 py-3 font-medium text-black transition-opacity hover:opacity-90"
        >
          {copy.hero.cta}
        </Link>
        <p className="text-sm text-orange">
          {copy.hero.counter(counters.moments, counters.countries)}
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
