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
