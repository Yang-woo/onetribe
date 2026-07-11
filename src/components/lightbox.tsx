'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef } from 'react'
import { youtubeThumbnail, type Moment } from '@/lib/moments'

/**
 * Wall lightbox — docs/15 §1: tap a card → overlay, swipe/arrows to move,
 * "open moment" → /m/[id]. Keyboard: Esc closes, ←/→ navigate (docs/15
 * accessibility rules).
 */
export function Lightbox({
  moments,
  index,
  onClose,
  onNavigate,
}: {
  moments: Moment[]
  index: number
  onClose: () => void
  onNavigate: (index: number) => void
}) {
  const moment = moments[index]
  const touchStartX = useRef<number | null>(null)

  const prev = useCallback(() => {
    if (index > 0) onNavigate(index - 1)
  }, [index, onNavigate])
  const next = useCallback(() => {
    if (index < moments.length - 1) onNavigate(index + 1)
  }, [index, moments.length, onNavigate])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      if (event.key === 'ArrowLeft') prev()
      if (event.key === 'ArrowRight') next()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, prev, next])

  if (!moment) return null

  const src =
    moment.media_kind === 'clip'
      ? (youtubeThumbnail(moment.embed_url ?? '') ?? undefined)
      : (moment.media_url ?? undefined)

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={moment.caption ?? 'moment'}
      className="fixed inset-0 z-50 flex flex-col bg-black/95"
      onClick={onClose}
      onTouchStart={(e) => {
        touchStartX.current = e.touches[0]?.clientX ?? null
      }}
      onTouchEnd={(e) => {
        const start = touchStartX.current
        touchStartX.current = null
        const end = e.changedTouches[0]?.clientX
        if (start == null || end == null) return
        if (end - start > 48) prev()
        if (start - end > 48) next()
      }}
    >
      <div className="flex items-center justify-between p-4">
        <Link
          href={`/m/${moment.id}`}
          onClick={(e) => e.stopPropagation()}
          className="text-sm text-flame hover:underline"
        >
          open moment
        </Link>
        <button
          type="button"
          aria-label="close"
          onClick={onClose}
          className="rounded-full border border-line px-3 py-1 text-sm text-muted hover:text-paper"
        >
          ✕
        </button>
      </div>

      <div className="flex flex-1 items-center justify-center overflow-hidden px-4 pb-4">
        {src && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={moment.caption ?? 'festival moment'}
            className="max-h-full max-w-full rounded-lg object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        )}
      </div>

      <div className="flex items-center justify-between p-4">
        <button
          type="button"
          aria-label="previous"
          disabled={index === 0}
          onClick={(e) => {
            e.stopPropagation()
            prev()
          }}
          className="rounded-full border border-line px-4 py-2 text-muted disabled:opacity-30"
        >
          ←
        </button>
        {moment.caption && <p className="px-4 text-center text-sm text-paper">{moment.caption}</p>}
        <button
          type="button"
          aria-label="next"
          disabled={index === moments.length - 1}
          onClick={(e) => {
            e.stopPropagation()
            next()
          }}
          className="rounded-full border border-line px-4 py-2 text-muted disabled:opacity-30"
        >
          →
        </button>
      </div>
    </div>
  )
}
