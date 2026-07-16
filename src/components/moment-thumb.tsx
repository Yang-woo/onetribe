'use client'

import { useLocale, useTranslations } from 'next-intl'
import { momentImageSrc, type EditionChip, type Moment } from '@/lib/moments'

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

/** Coarse localized relative time — minute / hour / day granularity. */
function relativeTime(iso: string, locale: string): string {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  const diffSec = Math.round((new Date(iso).getTime() - Date.now()) / 1000)
  const abs = Math.abs(diffSec)
  if (abs < 60) return rtf.format(0, 'second')
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), 'hour')
  return rtf.format(Math.round(diffSec / 86400), 'day')
}

/**
 * Wall card — the photo is the hero, UI stays quiet (docs/12). The edition
 * tag and the meta line add edition/realtime context (docs/15 §1). The tag is
 * decorative (aria-hidden); the alt still carries the caption. `edition` is
 * optional so the passport can reuse the card without a tag.
 */
export function MomentThumb({ moment, edition }: { moment: Moment; edition?: EditionChip }) {
  const t = useTranslations('wall')
  const locale = useLocale()
  const src = momentImageSrc(moment, { preferThumb: true })
  if (!src) return null

  const initials = edition ? anthemInitials(edition.edition) : null
  const tag = edition ? (initials ? `${edition.year} ${initials}` : String(edition.year)) : null
  const author = moment.author_name ? `@${moment.author_name}` : t('anonymous')
  const sep = (
    <span aria-hidden="true" className="text-[#6e655c]">
      ·
    </span>
  )

  return (
    <figure className="mb-3 break-inside-avoid overflow-hidden rounded-lg bg-surface">
      <div className="relative">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={moment.caption ?? 'festival moment'} loading="lazy" className="w-full" />
        {tag && (
          <span
            aria-hidden="true"
            className="absolute bottom-2 left-2 rounded bg-[rgba(11,9,8,0.75)] px-2 py-0.5 font-display text-[11px] tracking-[.02em] text-flame backdrop-blur-sm"
          >
            {tag}
          </span>
        )}
      </div>
      <figcaption className="flex flex-col gap-0.5 px-3 py-2">
        {moment.caption && <span className="text-sm text-paper">{moment.caption}</span>}
        <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
          <span>{author}</span>
          {moment.origin_country && (
            <>
              {sep}
              <span>{moment.origin_country}</span>
            </>
          )}
          {sep}
          <span suppressHydrationWarning>{relativeTime(moment.created_at, locale)}</span>
        </span>
      </figcaption>
    </figure>
  )
}
