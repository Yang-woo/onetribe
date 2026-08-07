'use client'

import { useLocale, useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { editionLine } from '@/lib/format'
import { momentImageSrc, type EditionChip, type Moment } from '@/lib/moments'
import { MomentMeta } from './moment-meta'
import { SkeletonImage } from './skeleton-image'

/** Caption translation via /api/translate (docs/00 D32). Best-effort: any
 *  failure resolves null and the modal keeps the original caption. A fresh
 *  identity per render is safe — ModalCaption latches it so the debounce is
 *  never restarted by a re-rendering host. */
export type TranslateImpl = (memoryId: string, locale: string) => Promise<string | null>

/**
 * How long a moment must stay open before its caption is translated (docs/00
 * D46). ←/→ flipping through the wall is faster than this, so photos the eye
 * merely passes over cost nothing; settling to read pays one round-trip.
 */
const TRANSLATE_DEBOUNCE_MS = 500

const defaultTranslate: TranslateImpl = async (memoryId, locale) => {
  try {
    const res = await fetch('/api/translate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ memoryId, locale }),
    })
    if (!res.ok) return null
    const data = (await res.json()) as { text?: string | null }
    return typeof data.text === 'string' ? data.text : null
  } catch {
    return null
  }
}

/**
 * Wall moment modal — docs/15 §1, docs/00 (wall UX pass). Tapping a card opens
 * the moment *in place*: the photo plus its context (edition, caption, the
 * uploader's Instagram, country/time) so the moment is consumable without a
 * page load. "open moment ↗" is a clear permalink to /m/[id] for sharing,
 * translation and removal. Swipe/arrows move; Esc closes (docs/15 a11y).
 */
export function Lightbox({
  moments,
  openId,
  editionById,
  onClose,
  onNavigate,
  translateImpl = defaultTranslate,
  translateDelayMs = TRANSLATE_DEBOUNCE_MS,
}: {
  moments: Moment[]
  /**
   * The open moment, by id — never an index. The list moves under the modal
   * (a live insert prepends to the wall), so an index would silently re-point
   * at a different photo mid-view (docs/00 D33). Resolving the index here, and
   * reporting ids back through `onNavigate`, keeps that guarantee inside the
   * modal instead of asking every host to re-implement the same adapter.
   */
  openId: string
  /** Edition lookup for the per-moment context line (no extra fetch). */
  editionById?: Map<string, EditionChip>
  onClose: () => void
  onNavigate: (id: string) => void
  /** test seam — the real impl hits /api/translate */
  translateImpl?: TranslateImpl
  /** test seam — the debounce window before a caption is translated */
  translateDelayMs?: number
}) {
  const t = useTranslations('moment')
  const locale = useLocale()
  const index = moments.findIndex((m) => m.id === openId)
  const moment = moments[index]
  const touchStartX = useRef<number | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  // One translation per (moment, locale) for as long as the modal is open.
  // The caption is keyed per moment, so ←/→ back to a photo already read
  // throws its state away and would re-buy the round-trip the debounce below
  // exists to avoid — worst of all for a caption whose language we never
  // detected, which pays again on every single settle. Lives with the modal:
  // it dies on close, so nothing has to be invalidated.
  //   `done` is the settled text, readable synchronously — a return trip must
  //   render translated on the FIRST frame, not flash the original for another
  //   debounce window. `inflight` dedupes the round-trip itself.
  const cacheRef = useRef<{
    inflight: Map<string, Promise<string | null>>
    done: Map<string, string>
  } | null>(null)
  cacheRef.current ??= { inflight: new Map(), done: new Map() }
  const cache = cacheRef.current

  const translateOnce = useCallback<TranslateImpl>(
    (memoryId, target) => {
      const key = `${memoryId}:${target}`
      const seen = cache.inflight.get(key)
      if (seen) return seen
      const pending = translateImpl(memoryId, target)
      cache.inflight.set(key, pending)
      // Only a real answer is worth keeping — a failure must stay retryable,
      // or one bad round-trip freezes that caption for the whole modal session.
      void pending.then(
        (text) => {
          if (text == null) cache.inflight.delete(key)
          else cache.done.set(key, text)
        },
        () => cache.inflight.delete(key),
      )
      return pending
    },
    [cache, translateImpl],
  )

  /** Synchronous peek at an already-settled translation (never a round-trip). */
  const knownTranslation = useCallback(
    (memoryId: string, target: string) => cache.done.get(`${memoryId}:${target}`) ?? null,
    [cache],
  )

  const prev = useCallback(() => {
    const target = index > 0 ? moments[index - 1] : undefined
    if (target) onNavigate(target.id)
  }, [index, moments, onNavigate])
  const next = useCallback(() => {
    const target = index >= 0 ? moments[index + 1] : undefined
    if (target) onNavigate(target.id)
  }, [index, moments, onNavigate])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      else if (event.key === 'ArrowLeft') prev()
      else if (event.key === 'ArrowRight') next()
      else if (event.key === 'Tab') {
        // Keep Tab inside the dialog so focus never lands on the wall cards
        // hidden behind the overlay (docs/15 a11y).
        const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled])',
        )
        if (!focusables || focusables.length === 0) return
        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        const active = document.activeElement
        if (event.shiftKey && (active === first || active === dialogRef.current)) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && active === last) {
          event.preventDefault()
          first.focus()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, prev, next])

  // Move focus into the dialog on open, restore it to the trigger on close.
  useEffect(() => {
    const restoreTo = document.activeElement as HTMLElement | null
    dialogRef.current?.focus()
    return () => restoreTo?.focus?.()
  }, [])

  // The open moment left the list (a sign-in swapped the passport's moments, a
  // hidden row dropped out of a refetch). Rendering nothing isn't enough — the
  // host still believes a modal is open, so tell it to close: that unmounts us,
  // which restores focus to the trigger and detaches the key handler. Latched:
  // both hosts unmount us in response, but a host that only re-rendered would
  // otherwise spin here (the inline `onClose` is a new identity every render).
  const missing = index < 0
  const closedRef = useRef(false)
  useEffect(() => {
    if (!missing || closedRef.current) return
    closedRef.current = true
    onClose()
  }, [missing, onClose])

  if (!moment) return null

  const src = momentImageSrc(moment) ?? undefined
  const edition = editionById?.get(moment.event_id)
  // Stops a click on the content panel from bubbling to the backdrop (close).
  const keepOpen = (e: React.MouseEvent) => e.stopPropagation()

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      tabIndex={-1}
      aria-label={moment.caption ?? t('imageAlt')}
      className="fixed inset-0 z-50 flex flex-col bg-black/95 focus:outline-none"
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
      <div className="flex items-center justify-end p-4">
        <button
          type="button"
          aria-label={t('close')}
          onClick={onClose}
          className="rounded-full border border-line px-3 py-1 text-sm text-muted hover:text-paper"
        >
          ✕
        </button>
      </div>

      <div className="flex flex-1 items-center justify-center overflow-hidden px-4">
        {src && (
          <SkeletonImage
            src={src}
            alt={moment.caption ?? t('imageAlt')}
            loading="eager"
            aspectRatio={moment.aspect_ratio}
            defaultAspectRatio="3 / 2"
            // The only place a moment is sized to the viewport's height rather
            // than a column's width — the row above gives it both axes.
            fit="height"
            className="rounded-lg"
            onClick={keepOpen}
          />
        )}
      </div>

      {/* Context panel — the moment made consumable inside the modal. */}
      <div className="mx-auto w-full max-w-3xl px-4 pb-4 pt-3" onClick={keepOpen}>
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            aria-label={t('previous')}
            disabled={index === 0}
            onClick={prev}
            className="rounded-full border border-line px-4 py-2 text-muted hover:text-paper disabled:opacity-30"
          >
            ←
          </button>
          <Link
            href={`/m/${moment.id}`}
            className="rounded-full border border-line px-4 py-1.5 text-sm text-flame hover:border-orange hover:text-orange"
          >
            {t('viewDetails')} ↗
          </Link>
          <button
            type="button"
            aria-label={t('next')}
            disabled={index === moments.length - 1}
            onClick={next}
            className="rounded-full border border-line px-4 py-2 text-muted hover:text-paper disabled:opacity-30"
          >
            →
          </button>
        </div>

        <div className="mt-3 flex flex-col gap-1 text-center">
          {edition && (
            <p className="font-display text-[13px] tracking-[.02em] text-flame">
              {editionLine(edition)}
            </p>
          )}
          {moment.caption && (
            // Keyed on moment+locale so navigating remounts it with fresh
            // translation state (no synchronous reset in an effect).
            <ModalCaption
              key={`${moment.id}-${locale}`}
              memoryId={moment.id}
              original={moment.caption}
              sourceLang={moment.source_lang}
              locale={locale}
              translateImpl={translateOnce}
              known={knownTranslation}
              delayMs={translateDelayMs}
            />
          )}
          <MomentMeta moment={moment} center />
        </div>
      </div>
    </div>
  )
}

/**
 * The modal caption is a TEASER (docs/00 D32): the viewer-language caption,
 * clamped to 3 lines. Translated once the viewer settles on the moment so the
 * glance is already localized, but the full text, the original toggle, sharing
 * and report all live on /m/[id] — that's what the "자세히 보기 ↗" permalink is
 * for. Mounted with a moment+locale key so each moment gets fresh translation
 * state; the fetch is best-effort and the original shows until (and unless) a
 * real translation lands.
 */
function ModalCaption({
  memoryId,
  original,
  sourceLang,
  locale,
  translateImpl,
  known,
  delayMs,
}: {
  memoryId: string
  original: string
  sourceLang: string | null
  locale: string
  translateImpl: TranslateImpl
  known: (memoryId: string, locale: string) => string | null
  delayMs: number
}) {
  // Seeded from the modal's cache, so stepping back to a moment already read
  // renders it translated on the first frame instead of re-flashing the
  // original for another debounce window.
  const [translated, setTranslated] = useState<string | null>(() => known(memoryId, locale))

  // Latched so an unstable `translateImpl` identity (a host passing an inline
  // lambda) can't restart the timer on every parent render and starve the
  // translation forever. Read at fire time, so a swapped impl still wins.
  const implRef = useRef(translateImpl)
  useEffect(() => {
    implRef.current = translateImpl
  }, [translateImpl])

  useEffect(() => {
    const trimmed = original.trim()
    // Skip the round-trip when the caption is already in the viewer's language —
    // the server would just echo the original (docs/00 D32 efficiency). null
    // source_lang (undetected) still fetches.
    if (!trimmed || sourceLang === locale) return
    // Already in hand from a previous view — the seeded state is showing it.
    if (known(memoryId, locale)) return
    let alive = true
    // Debounced, not on mount — see TRANSLATE_DEBOUNCE_MS. Navigating away
    // unmounts this, and that cleanup is what cancels the pending call.
    const timer = setTimeout(() => {
      // The rejection arm is required, not defensive: a throwing impl would
      // otherwise surface as an unhandled rejection (the cache contemplates one).
      void implRef.current(memoryId, locale).then(
        (text) => {
          // Only surface a genuine translation — an echo of the original changes nothing.
          if (alive && text && text.trim() !== trimmed) setTranslated(text)
        },
        () => {},
      )
    }, delayMs)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [memoryId, original, sourceLang, locale, known, delayMs])

  return <p className="line-clamp-3 text-sm text-paper">{translated ?? original}</p>
}
