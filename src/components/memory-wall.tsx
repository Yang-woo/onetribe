'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { fetchMoments, WALL_PAGE_SIZE, type Moment } from '@/lib/moments'
import { supabaseBrowser } from '@/lib/supabase/browser'
import { Lightbox } from './lightbox'
import { MomentThumb } from './moment-thumb'

type LoadMore = (before: import('@/lib/moments').MomentCursor) => Promise<Moment[]>
type Subscribe = (onInsert: (moment: Moment) => void) => () => void

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
  loadMoreImpl,
  subscribeImpl,
}: {
  initialMoments: Moment[]
  /** When an edition filter is active, the ids of that edition's events. */
  eventIds?: string[]
  loadMoreImpl?: LoadMore
  subscribeImpl?: Subscribe
}) {
  const t = useTranslations('wall')
  const [moments, setMoments] = useState(initialMoments)
  const [exhausted, setExhausted] = useState(initialMoments.length < WALL_PAGE_SIZE)
  const [loading, setLoading] = useState(false)
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
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

  if (moments.length === 0) {
    return (
      <section className="flex flex-col items-center gap-2 px-4 py-24 text-center">
        <h2 className="font-display text-2xl lowercase">{t('emptyTitle')}</h2>
        <p className="text-muted">{t('emptyBody')}</p>
      </section>
    )
  }

  return (
    <section className="px-4">
      <div className="columns-2 gap-3 md:columns-3 lg:columns-4">
        {moments.map((moment, index) => (
          <button
            key={moment.id}
            type="button"
            onClick={() => setLightboxIndex(index)}
            className="block w-full text-left"
            aria-label={moment.caption ?? 'open moment'}
          >
            <MomentThumb moment={moment} />
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
