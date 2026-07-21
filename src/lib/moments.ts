import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Public wall data access — anon clients only (RLS enforces live-only).
 * Explicit column list, never '*': takedown_token is unreadable by design
 * and selecting it would error (docs/02).
 */

// Single literal on purpose — concatenation breaks supabase-js type inference.
// This is the SSOT for anon-readable columns; the RLS grant test imports it.
export const PUBLIC_MEMORY_COLUMNS =
  'id, event_id, media_url, thumb_url, media_kind, embed_url, clip_start, clip_length, caption, source_lang, author_name, author_link, author_id, origin_country, status, created_at'

export interface Moment {
  id: string
  event_id: string
  media_url: string | null
  thumb_url: string | null
  media_kind: 'image' | 'gif' | 'clip'
  embed_url: string | null
  clip_start: number | null
  clip_length: number | null
  caption: string | null
  source_lang: string | null
  author_name: string | null
  author_link: string | null
  author_id: string | null
  origin_country: string | null
  status: string
  created_at: string
}

/** Loose-but-sufficient id guard shared by the moment page and OG route. */
export function isMomentId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)
}

export interface MomentEvent {
  festival: string
  edition: string | null
  year: number
  city: string | null
}

/** The events join fragment feeding eventLine() — one list for the page and OG. */
export const EVENT_LINE_COLUMNS = 'events ( festival, edition, year, city )'

/** The shareable identity line (docs/12 G): `city · year · festival — edition`. */
export function eventLine(event: MomentEvent | null): string | null {
  if (!event) return null
  const line = [event.city, event.year, event.festival].filter(Boolean).join(' · ')
  return event.edition ? `${line} — ${event.edition}` : line
}

/**
 * Displayable image source for a moment — clips fall back to their YouTube
 * thumbnail. The single place to touch when thumb variants or a second
 * embed host arrive.
 */
export function momentImageSrc(
  moment: Pick<Moment, 'media_kind' | 'media_url' | 'thumb_url' | 'embed_url'>,
  opts: { preferThumb?: boolean } = {},
): string | null {
  if (opts.preferThumb && moment.thumb_url) return moment.thumb_url
  if (moment.media_kind === 'clip') return youtubeThumbnail(moment.embed_url ?? '')
  return moment.media_url
}

export interface EditionChip {
  id: string
  year: number
  edition: string | null
  canceled: boolean
}

/**
 * The wall's `?e=` edition filter. One parser for both readers — the server
 * page (searchParams, docs/15 §1) and the client filter (popstate, docs/00 D13)
 * — so a deep link and a chip click can never disagree on what a URL means.
 * Anything that isn't a 4-digit year reads as "no filter".
 */
export function parseEditionYear(value: string | null | undefined): number | null {
  return value && /^\d{4}$/.test(value) ? Number(value) : null
}

/** The props a filter year resolves to on the wall. */
export interface WallFilterProps {
  /** The events behind the year — `undefined` (all) means no filter. */
  eventIds: string[] | undefined
  /** The edition driving the filter header (docs/15 §1). */
  filterEdition: EditionChip | undefined
  /** Id → edition for the per-card tag. */
  editionById: Map<string, EditionChip>
}

/**
 * Everything the wall needs for a given edition year, derived from the chip
 * list. The other half of the "single source, both readers" rule that
 * `parseEditionYear` starts (docs/00 D13): the server page and the client
 * filter share this, so the SSR wall and a post-click wall can't drift for the
 * same year.
 */
export function wallFilterFor(editions: EditionChip[], year: number | null): WallFilterProps {
  return {
    eventIds:
      year === null ? undefined : editions.filter((ed) => ed.year === year).map((ed) => ed.id),
    filterEdition: year === null ? undefined : editions.find((ed) => ed.year === year),
    editionById: new Map(editions.map((ed) => [ed.id, ed])),
  }
}

export const WALL_PAGE_SIZE = 40

/** Keyset cursor — created_at alone is not unique (a 5-photo batch shares one
 * timestamp), so pagination and neighbors key on (created_at, id). */
export interface MomentCursor {
  createdAt: string
  id: string
}

export async function fetchMoments(
  db: SupabaseClient,
  opts: { eventIds?: string[]; before?: MomentCursor; limit?: number } = {},
): Promise<Moment[]> {
  let query = db
    .from('memories')
    .select(PUBLIC_MEMORY_COLUMNS)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(opts.limit ?? WALL_PAGE_SIZE)
  if (opts.eventIds && opts.eventIds.length > 0) query = query.in('event_id', opts.eventIds)
  if (opts.before) {
    // (created_at, id) < (cursor) — the older side of the keyset
    query = query.or(
      `created_at.lt.${opts.before.createdAt},and(created_at.eq.${opts.before.createdAt},id.lt.${opts.before.id})`,
    )
  }
  const { data, error } = await query
  if (error) throw new Error(`fetchMoments failed: ${error.message}`)
  return (data ?? []) as unknown as Moment[]
}

// Upcoming editions we haven't surfaced yet. 2027 is announced (Jun 24–27) but
// Defqon.1 isn't actively promoting it, so we keep its chip off the wall — and
// out of the upload/passport pickers, since a future edition has no memories to
// hold yet. Delete a year here to bring its chip back once we choose to reveal it.
const HIDDEN_EDITION_YEARS = new Set<number>([2027])

/** NL mainline editions for the chip row (docs/11 B: intl editions stay off the UI for MVP). */
export async function fetchEditions(db: SupabaseClient): Promise<EditionChip[]> {
  const { data, error } = await db
    .from('events')
    .select('id, year, edition, canceled')
    .eq('festival', 'Defqon.1')
    .order('year', { ascending: false })
  if (error) throw new Error(`fetchEditions failed: ${error.message}`)
  return (data ?? []).filter((e) => !HIDDEN_EDITION_YEARS.has(e.year)) as EditionChip[]
}

export async function fetchCounters(
  db: SupabaseClient,
): Promise<{ moments: number; countries: number }> {
  const { data, error } = await db.from('wall_counters').select('moments, countries').single()
  if (error) throw new Error(`fetchCounters failed: ${error.message}`)
  return data as { moments: number; countries: number }
}

/** YouTube thumbnail for clip moments — id from the canonical watch URL. */
export function youtubeThumbnail(embedUrl: string): string | null {
  try {
    const id = new URL(embedUrl).searchParams.get('v')
    return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null
  } catch {
    return null
  }
}
