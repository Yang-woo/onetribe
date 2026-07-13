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
  edition?: string | null
  year: number
  city: string | null
}

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

export const WALL_PAGE_SIZE = 40

export async function fetchMoments(
  db: SupabaseClient,
  opts: { eventIds?: string[]; before?: string; limit?: number } = {},
): Promise<Moment[]> {
  let query = db
    .from('memories')
    .select(PUBLIC_MEMORY_COLUMNS)
    .order('created_at', { ascending: false })
    .limit(opts.limit ?? WALL_PAGE_SIZE)
  if (opts.eventIds && opts.eventIds.length > 0) query = query.in('event_id', opts.eventIds)
  if (opts.before) query = query.lt('created_at', opts.before)
  const { data, error } = await query
  if (error) throw new Error(`fetchMoments failed: ${error.message}`)
  return (data ?? []) as unknown as Moment[]
}

/** NL mainline editions for the chip row (docs/11 B: intl editions stay off the UI for MVP). */
export async function fetchEditions(db: SupabaseClient): Promise<EditionChip[]> {
  const { data, error } = await db
    .from('events')
    .select('id, year, edition, canceled')
    .eq('festival', 'Defqon.1')
    .order('year', { ascending: false })
  if (error) throw new Error(`fetchEditions failed: ${error.message}`)
  return (data ?? []) as EditionChip[]
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
