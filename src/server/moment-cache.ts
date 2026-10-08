import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Whether a moment is live right now, read around a write that may take it
 * down. COUNTERS_TAG empties every cached moment page (docs/00 D62), so the
 * write sites drop it only when a live moment actually went down — a drop on a
 * write that changed nothing (a repeated takedown, a second removal, a report
 * on a moment already down) lets anyone who can repeat that write keep the
 * cache cold. `null` means the read failed, and callers drop on it: a missed
 * drop leaves a taken-down moment on its cached page.
 *
 * Either client works: the service role reads `status`, and the anon client
 * only ever sees live rows (RLS), so a hidden one reads as absent.
 */
export async function isLive(db: SupabaseClient, id: string): Promise<boolean | null> {
  const { data, error } = await db.from('memories').select('status').eq('id', id).maybeSingle()
  return error ? null : data?.status === 'live'
}
