'use client'

import { useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import type { EditionChip } from '@/lib/moments'

/**
 * Horizontal edition filter — docs/15 §1. Canceled editions render in
 * Defqon Red (emotion role, docs/12 B); 2026 carries the "lost weekend"
 * label. Filter state lives in the URL (?e=2026) so views are shareable.
 *
 * The row scrolls sideways. Touch and trackpad already swipe it; the wheel
 * handler lets a plain vertical mouse wheel scroll it on desktop — macOS
 * overlay scrollbars are invisible and a mouse can't reach them — while
 * yielding to the page at the ends so vertical page scroll still works.
 */
export function EditionChips({
  editions,
  selectedYear,
}: {
  editions: EditionChip[]
  selectedYear: number | null
}) {
  const t = useTranslations('wall')
  const scrollerRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      // leave horizontal gestures (trackpad) alone — only remap vertical wheel
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return
      const max = el.scrollWidth - el.clientWidth
      if (max <= 0) return
      const atStart = el.scrollLeft <= 0
      const atEnd = el.scrollLeft >= max - 1
      // at an edge and scrolling further out → let the page scroll
      if ((e.deltaY < 0 && atStart) || (e.deltaY > 0 && atEnd)) return
      el.scrollLeft += e.deltaY
      e.preventDefault()
    }
    // passive:false so preventDefault can suppress the page scroll we consumed
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const base = 'shrink-0 rounded-full border px-3 py-1 text-sm transition-colors whitespace-nowrap'
  const idle = 'border-line text-muted hover:text-paper'
  const active = 'border-orange text-orange'
  const lost = 'border-red/40 text-red'

  return (
    <nav
      ref={scrollerRef}
      aria-label="editions"
      className="flex gap-2 overflow-x-auto px-4 py-3"
    >
      <Link href="/" className={`${base} ${selectedYear === null ? active : idle}`}>
        {t('allEditions')}
      </Link>
      {editions.map((edition) => {
        const isActive = selectedYear === edition.year
        const label =
          edition.year === 2026
            ? t('lostEditionChip', { year: edition.year })
            : String(edition.year)
        return (
          <Link
            key={edition.id}
            href={`/?e=${edition.year}`}
            aria-current={isActive ? 'page' : undefined}
            className={`${base} ${isActive ? active : edition.canceled ? lost : idle}`}
          >
            {label}
          </Link>
        )
      })}
    </nav>
  )
}
