'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { fetchMoments, WALL_PAGE_SIZE, type EditionChip, type Moment } from '@/lib/moments'
import { supabaseBrowser } from '@/lib/supabase/browser'
import { Lightbox } from './lightbox'
import { MomentThumb } from './moment-thumb'
import { PulseDot } from './pulse-dot'

export type LoadMore = (before: import('@/lib/moments').MomentCursor) => Promise<Moment[]>
export type Subscribe = (onInsert: (moment: Moment) => void) => () => void

function defaultLoadMore(eventIds?: string[]): LoadMore {
  return (before) => fetchMoments(supabaseBrowser(), { eventIds, before })
}

// Realtime INSERTs pass RLS (live rows only) and the publication's column
// list (no takedown_token) — see tests/db/wall.test.ts.
const defaultSubscribe: Subscribe = (onInsert) => {
  const client = supabaseBrowser()
  const channel = client
    .channel('wall')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'memories' }, (payload) =>
      onInsert(payload.new as Moment),
    )
    .subscribe()
  return () => {
    void client.removeChannel(channel)
  }
}

export function MemoryWall({
  initialMoments,
  eventIds,
  filterEdition,
  editionById,
  loadMoreImpl,
  subscribeImpl,
}: {
  initialMoments: Moment[]
  /** When an edition filter is active, the ids of that edition's events. */
  eventIds?: string[]
  /** The edition being filtered — drives the filter section header (docs/15 §1). */
  filterEdition?: EditionChip
  /** Edition lookup for the per-card edition tag (no extra fetch). */
  editionById?: Map<string, EditionChip>
  loadMoreImpl?: LoadMore
  subscribeImpl?: Subscribe
}) {
  const t = useTranslations('wall')
  const [moments, setMoments] = useState(initialMoments)
  const [exhausted, setExhausted] = useState(initialMoments.length < WALL_PAGE_SIZE)
  const [loading, setLoading] = useState(false)
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  // moments that landed live this session (past the active filter) — the
  // "just landed" signal. Resets per filter view (page re-keys on year).
  const [liveCount, setLiveCount] = useState(0)
  // seed with the ids already on screen so a re-delivered existing row never
  // inflates the "just landed" count. Lazy init — evaluated once per mount.
  const countedRef = useRef<Set<string> | null>(null)
  if (countedRef.current === null) countedRef.current = new Set(initialMoments.map((m) => m.id))
  const sentinelRef = useRef<HTMLDivElement>(null)

  const loadMore = useCallback(async () => {
    setLoading(true)
    try {
      const last = moments[moments.length - 1]
      if (!last) return
      const impl = loadMoreImpl ?? defaultLoadMore(eventIds)
      const next = await impl({ createdAt: last.created_at, id: last.id })
      if (next.length < WALL_PAGE_SIZE) setExhausted(true)
      setMoments((current) => {
        const seen = new Set(current.map((m) => m.id))
        return [...current, ...next.filter((m) => !seen.has(m.id))]
      })
    } finally {
      setLoading(false)
    }
  }, [moments, eventIds, loadMoreImpl])

  // New moments land on top, live (docs/15 §1 — no flashy animation).
  useEffect(() => {
    const subscribe = subscribeImpl ?? defaultSubscribe
    return subscribe((moment) => {
      if (eventIds && !eventIds.includes(moment.event_id)) return
      setMoments((current) =>
        current.some((m) => m.id === moment.id) ? current : [moment, ...current],
      )
      const counted = countedRef.current!
      if (!counted.has(moment.id)) {
        counted.add(moment.id)
        setLiveCount((c) => c + 1)
      }
    })
  }, [eventIds, subscribeImpl])

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel || exhausted) return
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && !loading) void loadMore()
    })
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [exhausted, loading, loadMore])

  const canceled = filterEdition?.canceled ?? false
  // A canceled edition keeps its real anthem title (2026 — Sacred Oath); the
  // red styling and the sub-line below carry the "never opened" meaning.
  const headerTitle = filterEdition
    ? filterEdition.edition
      ? `${filterEdition.year} — ${filterEdition.edition}`
      : String(filterEdition.year)
    : null

  // Rendered above both the grid and the empty state so a filtered-but-empty
  // view (e.g. a canceled year before it has uploads) still frames the edition.
  const filterHeader = filterEdition && (
    <div
      className={`mb-4 flex items-baseline justify-between gap-4 border-l-2 pb-1 pl-4 pt-4 ${
        canceled ? 'border-red' : 'border-orange'
      }`}
    >
      <div className="flex flex-col gap-1">
        <h2
          className={`font-display text-[26px] font-medium ${canceled ? 'text-red' : 'text-paper'}`}
        >
          {headerTitle}
        </h2>
        {canceled && (
          <p className="text-sm text-muted">
            {filterEdition.edition && <span>{filterEdition.edition} · </span>}
            {t('lostEditionSub')}
          </p>
        )}
      </div>
      {liveCount > 0 && (
        <p aria-live="polite" className="flex shrink-0 items-center gap-1.5 text-[13px] text-flame">
          <PulseDot />
          {t('liveFeed', { n: liveCount })}
        </p>
      )}
    </div>
  )

  if (moments.length === 0) {
    return (
      <section className="px-4">
        {filterHeader}
        <div className="flex flex-col items-center gap-2 py-24 text-center">
          <h2 className="font-display text-2xl lowercase">{t('emptyTitle')}</h2>
          <p className="text-muted">{t('emptyBody')}</p>
        </div>
      </section>
    )
  }

  return (
    <section className="px-4">
      {filterHeader}

      <div className="columns-2 gap-3 md:columns-3 lg:columns-4">
        {moments.map((moment, index) => (
          <button
            key={moment.id}
            type="button"
            onClick={() => setLightboxIndex(index)}
            className="block w-full text-left"
            aria-label={moment.caption ?? 'open moment'}
          >
            <MomentThumb moment={moment} edition={editionById?.get(moment.event_id)} />
          </button>
        ))}
      </div>
      {lightboxIndex !== null && (
        <Lightbox
          moments={moments}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onNavigate={setLightboxIndex}
        />
      )}
      {!exhausted && (
        <div ref={sentinelRef} className="flex justify-center py-8">
          <button
            type="button"
            onClick={() => void loadMore()}
            disabled={loading}
            className="rounded-full border border-line px-4 py-2 text-sm text-muted hover:text-paper disabled:opacity-50"
          >
            {t('loadMore')}
          </button>
        </div>
      )}
    </section>
  )
}
