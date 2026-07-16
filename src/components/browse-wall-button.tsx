'use client'

/**
 * Hero secondary CTA — smooth-scrolls to the wall. Uses window.scrollTo with
 * el.offsetTop (not scrollIntoView — project rule, docs/15 §1) so the sticky
 * header never overlaps the target.
 */
export function BrowseWallButton({
  targetId,
  className,
  children,
}: {
  targetId: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        const el = document.getElementById(targetId)
        if (!el) return
        // offset by the sticky header so the wall top isn't hidden under it
        const header = document.querySelector('header')
        const headerH = header instanceof HTMLElement ? header.offsetHeight : 0
        window.scrollTo({ top: el.offsetTop - headerH, behavior: 'smooth' })
      }}
    >
      {children}
    </button>
  )
}
