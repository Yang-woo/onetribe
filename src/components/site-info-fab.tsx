'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { SITE_LINKS } from '@/lib/site-links'
import { hasSupportLinks, SUPPORT_ANCHOR } from '@/lib/support'

/**
 * The policy links, on the one page where the footer is a long scroll away
 * (docs/00 D51). The wall's only extra chrome.
 *
 * Bottom-LEFT on purpose. Bottom-right is the primary-action corner and the
 * best thumb reach on a phone — spending it on the least-used links would both
 * misread as "add a moment" and waste the good real estate.
 *
 * On wide screens it parks in the empty gutter beside the 72rem wall rather
 * than in the viewport corner: `max()` keeps the 1rem inset while a phone has
 * no gutter to use, then hands over to the gutter position once one exists.
 * The distance to the wall stays 3.5rem at every width, so a bigger display
 * pushes it further from the viewport edge, never further from the photos.
 */
export function SiteInfoFab() {
  const t = useTranslations('footer')
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  // The panel has no backdrop of its own, so it needs both dismissals: Esc
  // (focus back to the button, since that's where the user came from) and a
  // press anywhere outside. Without the latter it survives a tap on a photo
  // and is still sitting there, open, when the modal closes.
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      buttonRef.current?.focus()
    }
    const onPointerDown = (event: Event) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('pointerdown', onPointerDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('pointerdown', onPointerDown)
    }
  }, [open])

  const linkClass = 'text-sm text-muted transition-colors hover:text-paper'

  return (
    <div
      ref={rootRef}
      className="hide-under-modal fixed bottom-8 left-[max(1rem,calc(50%_-_36rem_-_3.5rem))] z-40"
    >
      {/* Trigger before panel in DOM order: a keyboard reader Tabs forward
          into the links. `absolute` puts the panel above it on screen anyway,
          so source order is free to follow the interaction instead. */}
      <button
        ref={buttonRef}
        type="button"
        aria-label={t('info')}
        aria-expanded={open}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        // Same overlay idiom the thumbnails' expand button already uses
        // (translucent black + blur), so this reads on a photo when a phone
        // has no gutter, without inventing a second floating-control style.
        className="grid h-10 w-10 place-items-center rounded-full border border-[rgba(163,154,144,0.3)] bg-black/55 text-muted backdrop-blur-sm transition-colors hover:border-[rgba(163,154,144,0.55)] hover:text-paper"
      >
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <circle cx="10" cy="10" r="8.25" stroke="currentColor" strokeWidth="1.3" />
          <circle cx="10" cy="6.1" r="1.05" fill="currentColor" />
          <path d="M10 9.1v5.1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <nav
          aria-label={t('info')}
          className="absolute bottom-13 left-0 flex w-58 flex-col gap-2.5 rounded-xl border border-line bg-surface-raised p-4 shadow-[0_18px_48px_rgba(0,0,0,0.6)]"
        >
          {SITE_LINKS.map((key) => (
            <Link key={key} href={`/${key}`} className={linkClass}>
              {t(`links.${key}`)}
            </Link>
          ))}
          {/* Donations enter via About's no-perk framing, never a direct
              external link (D15) — same rule as the footer. */}
          {hasSupportLinks() && (
            <Link href={SUPPORT_ANCHOR} className={linkClass}>
              {t('links.support')}
            </Link>
          )}
        </nav>
      )}
    </div>
  )
}
