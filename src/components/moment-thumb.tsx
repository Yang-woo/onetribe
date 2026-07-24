'use client'

import { useLocale, useTranslations } from 'next-intl'
import { countryFlag, countryName } from '@/lib/country'
import { relativeTime } from '@/lib/format'
import { momentImageSrc, type EditionChip, type Moment } from '@/lib/moments'
import { AuthorTag } from './author-tag'
import { SkeletonImage } from './skeleton-image'

/** Anthem → initials, each word's first letter, ≤4: "Power of the Tribe" → "POTT". */
function anthemInitials(anthem: string | null): string | null {
  if (!anthem) return null
  const initials = anthem
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase())
    .join('')
    .slice(0, 4)
  return initials || null
}

/**
 * Wall card — the photo is the hero, UI stays quiet (docs/12). The edition
 * tag and the meta line add edition/realtime context (docs/15 §1). The tag is
 * decorative (aria-hidden); the alt still carries the caption. `edition` is
 * optional so the passport can reuse the card without a tag.
 *
 * The image is the click target: `onOpen` (the wall) makes it a button that
 * opens the moment modal, with a desktop hover affordance. The author `@handle`
 * is a *separate* Instagram link so it's reachable without opening the modal
 * (docs/00 — wall Instagram link, distinct hit areas). Without `onOpen` (the
 * passport) the image is inert, exactly as before.
 */
export function MomentThumb({
  moment,
  edition,
  onOpen,
}: {
  moment: Moment
  edition?: EditionChip
  /** Opens the moment modal for this card; omitted where the thumb is inert. */
  onOpen?: () => void
}) {
  const tm = useTranslations('moment')
  const locale = useLocale()
  const src = momentImageSrc(moment, { preferThumb: true })
  if (!src) return null

  const initials = edition ? anthemInitials(edition.edition) : null
  const tag = edition ? (initials ? `${edition.year} ${initials}` : String(edition.year)) : null
  const sep = (
    <span aria-hidden="true" className="text-[#6e655c]">
      ·
    </span>
  )

  const alt = moment.caption ?? 'festival moment'
  const tagEl = tag && (
    <span
      aria-hidden="true"
      className="absolute bottom-2 left-2 z-10 rounded bg-[rgba(11,9,8,0.75)] px-2 py-0.5 font-display text-[11px] tracking-[.02em] text-flame backdrop-blur-sm"
    >
      {tag}
    </span>
  )

  return (
    <figure className="mb-3 break-inside-avoid overflow-hidden rounded-lg bg-surface">
      {onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          aria-label={moment.caption ?? tm('openMoment')}
          className="group relative block w-full overflow-hidden"
        >
          <SkeletonImage
            src={src}
            alt={alt}
            loading="lazy"
            aspectRatio={moment.aspect_ratio}
            wrapperClassName="w-full"
            className="w-full transition-transform duration-500 ease-out group-hover:scale-[1.04] motion-reduce:transform-none"
          />
          {tagEl}
          {/* Desktop hover affordance (pointer devices): a faint scrim + an
              expand glyph so the card visibly invites a click. Hidden on touch,
              where the whole card is the obvious tap target. */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 hidden bg-black/10 opacity-0 transition-opacity duration-300 group-hover:opacity-100 md:block"
          />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute right-2 top-2 hidden h-7 w-7 place-items-center rounded-full bg-black/55 text-paper opacity-0 backdrop-blur-sm transition-opacity duration-300 group-hover:opacity-100 md:grid"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
            </svg>
          </span>
        </button>
      ) : (
        <div className="relative">
          <SkeletonImage
            src={src}
            alt={alt}
            loading="lazy"
            aspectRatio={moment.aspect_ratio}
            wrapperClassName="w-full"
            className="w-full"
          />
          {tagEl}
        </div>
      )}
      <figcaption className="flex flex-col gap-0.5 px-3 py-2">
        {moment.caption && <span className="text-sm text-paper">{moment.caption}</span>}
        <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
          {/* Display name (or @handle) — links to Instagram when the uploader
              gave one; a separate hit area from the image so the wall reaches it
              without opening the modal (docs/00 D30). */}
          <AuthorTag moment={moment} />
          {moment.origin_country && (
            <>
              {sep}
              {/* flag emoji (docs/00 D31); title carries the localized name for
                  hover + assistive tech. Falls back to the code if the flag
                  can't be derived. */}
              <span title={countryName(moment.origin_country, locale)}>
                {countryFlag(moment.origin_country) || moment.origin_country}
              </span>
            </>
          )}
          {sep}
          <span suppressHydrationWarning>{relativeTime(moment.created_at, locale)}</span>
        </span>
      </figcaption>
    </figure>
  )
}
