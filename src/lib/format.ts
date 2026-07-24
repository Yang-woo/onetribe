/**
 * Coarse localized relative time — minute / hour / day granularity. Shared by
 * the wall card and the lightbox so "2 hours ago" reads identically wherever a
 * moment's age is shown. Uses Date.now(), so callers that render it server-side
 * must suppress hydration warnings on the surrounding node.
 */
export function relativeTime(iso: string, locale: string): string {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  const diffSec = Math.round((new Date(iso).getTime() - Date.now()) / 1000)
  const abs = Math.abs(diffSec)
  if (abs < 60) return rtf.format(0, 'second')
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), 'hour')
  return rtf.format(Math.round(diffSec / 86400), 'day')
}

/** The edition context line for a moment card/modal on the wall: `year — anthem`
 *  (the wall has no city/festival join — editions are all Defqon.1). */
export function editionLine(edition: { year: number; edition: string | null }): string {
  return edition.edition ? `${edition.year} — ${edition.edition}` : String(edition.year)
}

/**
 * The bare Instagram handle from a stored `author_link`
 * (`https://instagram.com/lee_yangwoo` → `lee_yangwoo`). The `@` prefix belongs
 * on the handle, never on the display name (author_name) — the two are distinct
 * fields (docs/00 D30). Returns null when there's no link or it doesn't parse.
 */
export function instagramHandle(authorLink: string | null | undefined): string | null {
  if (!authorLink) return null
  try {
    const path = new URL(authorLink).pathname.replace(/^\/+|\/+$/g, '')
    return path || null
  } catch {
    return null
  }
}
