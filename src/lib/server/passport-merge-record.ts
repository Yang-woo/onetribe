import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * The `passport_merges` seam, shared by the two routes that touch it: the merge
 * handler writes a record, the publish handler reads one (docs/00 D45). It
 * lives here rather than in either route so neither imports the other.
 */

/**
 * Fingerprint of the anonymous session's access token. The token itself is a
 * bearer credential and is never stored — the hash is only ever compared
 * against a token the caller already holds, which is exactly the proof we want.
 */
export function sourceTokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** A token older than this is past its own expiry; a match can only be a replay. */
const MATCH_WINDOW_MS = 24 * 60 * 60 * 1000

/**
 * The account that absorbed the passport this token belonged to, if the token
 * was folded in recently — otherwise null. Best-effort by design: a failure
 * here must never fail an upload, it just costs the attribution the caller was
 * going to lose anyway.
 */
export async function mergedTargetFor(db: SupabaseClient, token: string): Promise<string | null> {
  const since = new Date(Date.now() - MATCH_WINDOW_MS).toISOString()
  const { data } = await db
    .from('passport_merges')
    .select('target_id')
    .eq('source_token_sha256', sourceTokenHash(token))
    .gte('created_at', since)
    .maybeSingle()
  return data?.target_id ?? null
}
