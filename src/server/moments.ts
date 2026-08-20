import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { COUNTERS_TAG } from '@/lib/cache-tags'
import { json, parseBody, requireBearerUser } from '@/lib/server/http'

/**
 * Uploader self-removal from the passport (docs/00 D54).
 *
 * Before this, the only self-serve way down was the secret `/t/[id]/[token]`
 * link on the upload confirmation screen: scroll past that screen and the
 * moment was stuck until the operator removed it by hand. The passport already
 * proves ownership — `memories.author_id` is the uploader's passport id — so
 * the bearer token is a credential the token link doesn't replace but sits
 * beside. (The token stays: it covers uploads that were never attributed.)
 *
 * Hides, never deletes — the same soft takedown as the token path (docs/09 C),
 * so the operator can still audit and restore a misclick. `memories_read_live`
 * then drops it from the wall AND from the owner's own passport.
 *
 * Writes go through the service role like every other write (D9 P1); there are
 * no write policies on `memories` to lean on.
 */

export interface MomentRemoveDeps {
  db: SupabaseClient // service role
  /** Cache seam — a removal lowers the wall's live count (docs/00 D41). */
  revalidate: (tag: string) => void
}

const removeSchema = z.object({ memoryId: z.uuid() })

export function createMomentRemoveHandler(deps: MomentRemoveDeps) {
  return async (req: Request): Promise<Response> => {
    const auth = await requireBearerUser(deps.db, req)
    if (auth.denied) return auth.denied

    const parsed = removeSchema.safeParse(await parseBody(req))
    if (!parsed.success) return json(400, { error: 'invalid request' })

    // Ownership is an argument to the write, not a read before it: `hide_memory`
    // puts `author_id = <caller>` in the same WHERE clause that hides the row,
    // so there is no window between proving who you are and the moment going
    // down, and a moment belonging to someone else simply matches nothing.
    // author_id is NULL on moments whose owner deleted their account, so those
    // match no caller either.
    //
    // Going through that function rather than writing the row here is what
    // makes the 'owner' label mean something: it is the only channel that can
    // set one, and a moment that is already down keeps the label it went down
    // with (docs/00 D55). Removing your own already-reported moment therefore
    // still succeeds — it just doesn't repaint why it is off the wall.
    const { data, error } = await deps.db.rpc('hide_memory', {
      p_memory_id: parsed.data.memoryId,
      p_reason: 'owner',
      p_author_id: auth.user.id,
    })
    if (error) return json(500, { error: 'could not remove the moment' })
    // Not theirs and not there are the same answer on purpose — a 403 for
    // someone else's id would confirm that id exists.
    const matched = (Array.isArray(data) ? data[0] : data)?.matched === true
    if (!matched) return json(404, { error: 'not found' })

    // Best-effort like the other takedown sites: the row is already hidden, so
    // a cache miss must not turn a completed removal into an error.
    try {
      deps.revalidate(COUNTERS_TAG)
    } catch {
      // a stale count for up to 60s is not worth failing a successful removal
    }
    return json(200, { ok: true })
  }
}
