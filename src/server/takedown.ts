import type { SupabaseClient } from '@supabase/supabase-js'
import { COUNTERS_TAG } from '@/lib/cache-tags'
import { isLive } from './moment-cache'

/**
 * Uploader self-takedown by the secret link (docs/17 T1.5) — the body of the
 * `/t/[id]/[token]` form action, kept out of the page so it can be tested.
 * Possession of the token is the credential; `takedown_memory` checks it.
 */

export interface TakedownDeps {
  db: SupabaseClient // anon — the RPC is the anon-callable path
  revalidate: (tag: string) => void
}

/** The page's `done` code: '1' taken down, '0' bad link, 'error' retry. */
export type TakedownOutcome = '1' | '0' | 'error'

export function createTakedown(deps: TakedownDeps) {
  return async (id: string, token: string): Promise<TakedownOutcome> => {
    // Read before the write: the RPC answers true for a moment that is already
    // down too, and replaying one link must not empty the moment-page cache
    // each time (docs/00 D62, see isLive).
    const wasLive = await isLive(deps.db, id)
    const { data, error } = await deps.db.rpc('takedown_memory', {
      p_memory_id: id,
      p_token: token,
    })
    // A transient RPC failure is not an invalid link — route to a retry message,
    // not "invalid" (which reads as "your link is broken, give up"). With the
    // idempotent RPC (migration 20260725000300) a matching token yields true even
    // if the moment was already hidden, so `false` means a genuinely bad token.
    if (error) return 'error'
    if (data !== true) return '0'
    // The hide lowers the wall's cached count (docs/00 D12/D41) and must take
    // the moment's cached page down (D62). Best-effort: the hide already
    // committed, so a cache failure must not turn it into an error page.
    if (wasLive !== false) {
      try {
        deps.revalidate(COUNTERS_TAG)
      } catch {
        // stale until a later drop or the moment page's ceiling
      }
    }
    return '1'
  }
}
