'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  fetchMoments,
  parseEditionYear,
  wallFilterFor,
  type EditionChip,
  type Moment,
  type WallFilterProps,
} from '@/lib/moments'
import { supabaseBrowser } from '@/lib/supabase/browser'
import { EditionChips, type ChipYear } from './edition-chips'
import { MemoryWall, type LoadMore, type Subscribe } from './memory-wall'

export type FetchFiltered = (opts: { eventIds?: string[] }) => Promise<Moment[]>

const defaultFetch: FetchFiltered = (opts) => fetchMoments(supabaseBrowser(), opts)

function yearFromSearch(search: string): number | null {
  return parseEditionYear(new URLSearchParams(search).get('e'))
}

/** A resolved filter — the year, its wall props, and the moments fetched for it.
 *  `eventIds` keeps its identity here so MemoryWall's realtime effect (which
 *  keys on it) doesn't resubscribe on unrelated re-renders. */
type Filter = WallFilterProps & { year: number | null; moments: Moment[] }

/**
 * The wall's filter shell (docs/00 D13). Chips render immediately from the
 * cached editions; the first wall is server-rendered and streams in as
 * `children` — D12's cached shell and Suspense boundary, kept as-is — so deep
 * links, shares and crawlers still get SSR HTML.
 *
 * Once the visitor taps a chip we stop navigating: the click is intercepted,
 * the moments are fetched straight from Supabase in the browser, and the wall
 * swaps in place — no RSC round-trip. The URL still moves, via `pushState`
 * rather than `router.push` (which would refetch the page), and `popstate`
 * replays back/forward, so shareable `?e=` URLs survive.
 *
 * The chips stay real `<a href>`s so crawlers and modified clicks (open in a
 * new tab) still work. Note this is not a full no-JS fallback: the Suspense
 * boundary above already needs JS to place the streamed wall, so scripts-off
 * shows the skeleton either way.
 */
export function WallFilter({
  editions,
  initialSelectedYear,
  children,
  fetchImpl,
  loadMoreImpl,
  subscribeImpl,
  reloadImpl,
}: {
  editions: EditionChip[]
  initialSelectedYear: number | null
  /** The server-rendered initial wall — shown until the visitor filters. */
  children: React.ReactNode
  fetchImpl?: FetchFiltered
  loadMoreImpl?: LoadMore
  subscribeImpl?: Subscribe
  /** How to bail out to the server when the client fetch fails. */
  reloadImpl?: () => void
}) {
  // null → still showing the server-rendered `children`. The first filter
  // hands the wall over to the client for the rest of the visit.
  const [filter, setFilter] = useState<Filter | null>(null)
  const [pendingYear, setPendingYear] = useState<ChipYear | null>(null)
  // guards against a slow earlier fetch landing after a newer one
  const requestRef = useRef(0)

  const activeYear = filter ? filter.year : initialSelectedYear

  const load = useCallback(
    async (year: number | null, push: boolean) => {
      const request = ++requestRef.current
      setPendingYear(year ?? 'all')
      if (push) {
        const url = year === null ? location.pathname : `${location.pathname}?e=${year}`
        history.pushState(null, '', url)
      }
      const props = wallFilterFor(editions, year)
      try {
        const moments = await (fetchImpl ?? defaultFetch)({ eventIds: props.eventIds })
        if (requestRef.current !== request) return // a newer chip won the race
        setFilter({ year, moments, ...props })
        setPendingYear(null)
      } catch {
        if (requestRef.current !== request) return
        // The client shortcut failed. The URL already says ?e=<year>, so hand
        // it back to the server rather than strand the visitor on the previous
        // edition's moments under a filtered URL — a wall that lies about what
        // it is showing is worse than a reload.
        const reload = reloadImpl ?? (() => location.reload())
        reload()
      }
    },
    [editions, fetchImpl, reloadImpl],
  )

  const select = useCallback(
    (year: number | null) => {
      if (year === activeYear) return // already on screen — don't refetch
      void load(year, true)
    },
    [activeYear, load],
  )

  // back/forward through the pushState entries above
  useEffect(() => {
    const onPopState = () => {
      const year = yearFromSearch(location.search)
      if (year === activeYear) return
      void load(year, false)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [activeYear, load])

  const pending = pendingYear !== null

  return (
    <>
      <EditionChips
        editions={editions}
        selectedYear={activeYear}
        onSelect={select}
        pendingYear={pendingYear}
      />
      {/* Dim rather than swap in a skeleton: the outgoing wall keeps its
          layout, so the incoming one doesn't jolt the page (docs/15 states). */}
      <div
        aria-busy={pending}
        className={`transition-opacity ${pending ? 'pointer-events-none opacity-50' : ''}`}
      >
        {filter ? (
          <MemoryWall
            key={filter.year ?? 'all'}
            initialMoments={filter.moments}
            eventIds={filter.eventIds}
            filterEdition={filter.filterEdition}
            editionById={filter.editionById}
            loadMoreImpl={loadMoreImpl}
            subscribeImpl={subscribeImpl}
          />
        ) : (
          children
        )}
      </div>
    </>
  )
}
