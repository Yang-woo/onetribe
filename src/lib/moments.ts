import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Public wall data access — anon clients only (RLS enforces live-only).
 * Explicit column list, never '*': takedown_token is unreadable by design
 * and selecting it would error (docs/02).
 */

// Single literal on purpose — concatenation breaks supabase-js type inference.
export const PUBLIC_MEMORY_COLUMNS =
  'id, event_id, media_url, thumb_url, media_kind, embed_url, clip_start, clip_length, caption, source_lang, author_name, author_link, origin_country, status, created_at'

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
  origin_country: string | null
  status: string
  created_at: string
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
