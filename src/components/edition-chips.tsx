'use client'

import { useEffect, useRef } from 'react'
import { useLinkStatus } from 'next/link'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import type { EditionChip } from '@/lib/moments'

/**
 * Chip label with a pending cue — the filter is a dynamic server navigation,
 * so `useLinkStatus` dims the tapped chip the instant it's clicked (before the
 * server responds), pairing with the wall skeleton so the click never feels dead.
 */
function ChipLabel({ children }: { children: React.ReactNode }) {
  const { pending } = useLinkStatus()
  return <span className={pending ? 'animate-pulse opacity-60' : undefined}>{children}</span>
}

/**
 * Horizontal edition filter — docs/15 §1. Canceled editions render in
 * Defqon Red (emotion role, docs/12 B); 2026 carries the "lost weekend"
 * label. Filter state lives in the URL (?e=2026) so views are shareable.
 *
 * The row scrolls sideways. Touch and trackpad already swipe it. On desktop
 * we add two mouse affordances (macOS hides the overlay scrollbar, so a mouse
 * otherwise can't reach the older editions): a wheel handler that remaps the
 * vertical wheel to horizontal scroll (yielding to the page at the ends), and
 * click-drag — grab the row and pull. A drag past a few px cancels the click
 * that follows so dragging never navigates a chip.
 *
 * Drag tracking uses window-level pointer listeners (not setPointerCapture,
 * which retargets the trailing click and breaks React's delegated handlers)
 * so the pull keeps up with the cursor wherever it goes.
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
    // drag is active only while the window listeners are attached, so no
    // "down" flag is needed — the pointermove handler can't fire otherwise.
    const drag = { startX: 0, startLeft: 0, moved: false }

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

    const onPointerMove = (e: PointerEvent) => {
      const dx = e.clientX - drag.startX
      if (Math.abs(dx) > 3) drag.moved = true
      el.scrollLeft = drag.startLeft - dx
    }
    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
    }
    const onPointerDown = (e: PointerEvent) => {
      // mouse only — touch scrolls natively; don't fight it
      if (e.pointerType !== 'mouse' || e.button !== 0) return
      if (el.scrollWidth <= el.clientWidth) return // nothing to drag
      drag.startX = e.clientX
      drag.startLeft = el.scrollLeft
      drag.moved = false
      // track on window so the drag follows the cursor past the row's edges
      window.addEventListener('pointermove', onPointerMove)
      window.addEventListener('pointerup', onPointerUp)
    }
    // capture phase beats the Link's click, so a drag never navigates
    const onClickCapture = (e: MouseEvent) => {
      if (!drag.moved) return
      e.preventDefault()
      e.stopPropagation()
      drag.moved = false
    }

    // passive:false so preventDefault can suppress the page scroll we consumed
    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('click', onClickCapture, true)
    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('click', onClickCapture, true)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
    }
  }, [])

  const base = 'shrink-0 rounded-full border px-3 py-1 text-sm transition-colors whitespace-nowrap'
  const idle = 'border-line text-muted hover:text-paper'
  const active = 'border-orange text-orange'
  const lost = 'border-red/40 text-red'

  return (
    <nav
      ref={scrollerRef}
      aria-label="editions"
      className="flex cursor-grab select-none gap-2 overflow-x-auto px-4 py-3 active:cursor-grabbing"
    >
      <Link
        href="/"
        draggable={false}
        className={`${base} ${selectedYear === null ? active : idle}`}
      >
        <ChipLabel>{t('allEditions')}</ChipLabel>
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
            draggable={false}
            aria-current={isActive ? 'page' : undefined}
            className={`${base} ${isActive ? active : edition.canceled ? lost : idle}`}
          >
            <ChipLabel>{label}</ChipLabel>
          </Link>
        )
      })}
    </nav>
  )
}
