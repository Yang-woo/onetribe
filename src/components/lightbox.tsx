'use client'

import { useLocale, useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { useCallback, useEffect, useRef } from 'react'
import { countryFlag, countryName } from '@/lib/country'
import { editionLine, relativeTime } from '@/lib/format'
import { momentImageSrc, type EditionChip, type Moment } from '@/lib/moments'
import { SkeletonImage } from './skeleton-image'

/**
 * Wall moment modal — docs/15 §1, docs/00 (wall UX pass). Tapping a card opens
 * the moment *in place*: the photo plus its context (edition, caption, the
 * uploader's Instagram, country/time) so the moment is consumable without a
 * page load. "open moment ↗" is a clear permalink to /m/[id] for sharing,
 * translation and removal. Swipe/arrows move; Esc closes (docs/15 a11y).
 */
export function Lightbox({
  moments,
  index,
  editionById,
  onClose,
  onNavigate,
}: {
  moments: Moment[]
  index: number
  /** Edition lookup for the per-moment context line (no extra fetch). */
  editionById?: Map<string, EditionChip>
  onClose: () => void
  onNavigate: (index: number) => void
}) {
  const t = useTranslations('moment')
  const tw = useTranslations('wall')
  const locale = useLocale()
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

  const src = momentImageSrc(moment) ?? undefined
  const edition = editionById?.get(moment.event_id)
  const author = moment.author_name ? `@${moment.author_name}` : tw('anonymous')
  const igLink = moment.author_name ? moment.author_link : null
  const sep = (
    <span aria-hidden="true" className="text-[#6e655c]">
      ·
    </span>
  )
  // Stops a click on the content panel from bubbling to the backdrop (close).
  const keepOpen = (e: React.MouseEvent) => e.stopPropagation()

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
            alt={moment.caption ?? 'festival moment'}
            loading="eager"
            aspectRatio={moment.aspect_ratio}
            defaultAspectRatio="3 / 2"
            wrapperClassName="flex max-h-full items-center justify-center"
            className="max-h-full max-w-full rounded-lg object-contain"
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
          {moment.caption && <p className="text-sm text-paper">{moment.caption}</p>}
          <span className="flex flex-wrap items-center justify-center gap-1.5 text-xs text-muted">
            {igLink ? (
              <a
                href={igLink}
                target="_blank"
                rel="noopener noreferrer nofollow"
                aria-label={`Instagram ${author}`}
                className="text-flame hover:underline"
              >
                {author}
              </a>
            ) : (
              <span>{author}</span>
            )}
            {moment.origin_country && (
              <>
                {sep}
                <span title={countryName(moment.origin_country, locale)}>
                  {countryFlag(moment.origin_country) || moment.origin_country}
                </span>
              </>
            )}
            {sep}
            <span suppressHydrationWarning>{relativeTime(moment.created_at, locale)}</span>
          </span>
        </div>
      </div>
    </div>
  )
}
