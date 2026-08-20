import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { COUNTERS_TAG } from '@/lib/cache-tags'
import { json, parseBody, requireBearerUser } from '@/lib/server/http'
import type { StorageAdapter } from '@/lib/storage'

/**
 * Post-moderation admin — docs/15 §5, docs/09 E. Access model per D9 P10:
 * a Supabase email session whose address is on the ADMIN_EMAILS allowlist;
 * all writes run through these routes with the service role. There are no
 * admin RLS policies by design.
 */

export interface AdminDeps {
  db: SupabaseClient // service role
  adminEmails: string[] // lowercase
  storage: StorageAdapter // delete removes the media object too (docs/00 D9-c)
}

/** Moderation moves the live count, so the action handler additionally needs the
 *  cache seam — the read-only queue handler does not (docs/00 D12). */
export interface ModerationDeps extends AdminDeps {
  revalidate: (tag: string) => void
}

async function requireAdmin(deps: AdminDeps, req: Request): Promise<Response | null> {
  const auth = await requireBearerUser(deps.db, req)
  if (auth.denied) return auth.denied
  const email = auth.user.email?.toLowerCase()
  if (!email) return json(401, { error: 'sign in required' })
  if (!deps.adminEmails.includes(email)) return json(403, { error: 'not an operator' })
  return null
}

// Admin reads use the service role — includes hidden rows on purpose
// (that's the job) but never takedown_token (nothing here needs it).
const ADMIN_MEMORY_COLUMNS =
  'id, caption, media_url, thumb_url, media_kind, embed_url, status, hidden_reason, author_name, origin_country, created_at'

export function createAdminQueueHandler(deps: AdminDeps) {
  return async (req: Request): Promise<Response> => {
    const denied = await requireAdmin(deps, req)
    if (denied) return denied

    const startOfDay = new Date()
    startOfDay.setUTCHours(0, 0, 0, 0)

    const [reports, recent, hidden, todayLive, openReports] = await Promise.all([
      deps.db
        .from('reports')
        .select(`id, reason, created_at, memories ( ${ADMIN_MEMORY_COLUMNS} )`)
        .order('created_at', { ascending: false })
        .limit(100),
      deps.db
        .from('memories')
        .select(ADMIN_MEMORY_COLUMNS)
        .order('created_at', { ascending: false })
        .limit(50),
      deps.db.from('memories').select('*', { count: 'exact', head: true }).eq('status', 'hidden'),
      deps.db
        .from('memories')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'live')
        .gte('created_at', startOfDay.toISOString()),
      deps.db.from('reports').select('*', { count: 'exact', head: true }),
    ])

    // A swallowed DB error here would render the console as "0 reports, all
    // clear" — the most dangerous moderation failure. Surface it as a 500 so the
    // operator sees a fault instead of a false all-clear.
    if ([reports, recent, hidden, todayLive, openReports].some((r) => r.error)) {
      return json(500, { error: 'could not load the queue' })
    }

    return json(200, {
      reports: reports.data ?? [],
      recent: recent.data ?? [],
      counters: {
        hidden: hidden.count ?? 0,
        todayLive: todayLive.count ?? 0,
        openReports: openReports.count ?? 0,
      },
    })
  }
}

const actionSchema = z.object({
  memoryId: z.uuid(),
  // hide: take down · unhide: restore after review · delete: remove for good
  // dismiss: keep it up, clear its reports (the "OK" key — docs/15 §5)
  action: z.enum(['hide', 'unhide', 'delete', 'dismiss']),
  // unhide only — which decision the operator is overruling. `restore_memory`
  // refuses to put back a moment its author (or a takedown-link holder) took
  // down, and refuses rows whose provenance was never recorded, until the
  // caller names the label it saw. Naming it is also the compare-and-set: a
  // label that changed since the console drew the row is refused again rather
  // than overruled blind (docs/00 D55).
  acknowledge: z.enum(['owner', 'token', 'unknown']).optional(),
})

/** A `returns table (…)` function arrives as a one-row array through PostgREST. */
function firstRow<T>(data: unknown): T | null {
  return (Array.isArray(data) ? (data[0] as T | undefined) : (data as T | undefined)) ?? null
}

/**
 * Clear a moment's reports — the "OK" key (docs/09 B, docs/15 §5). Restoring
 * clears them too, but that half now happens inside `restore_memory`: it has to
 * be in the same transaction as the status flip, and it has to be skipped for
 * the rows an operator restores without having adjudicated anything (docs/00
 * D55). Returns a 500 Response on failure, else null.
 */
async function clearReports(db: SupabaseClient, memoryId: string): Promise<Response | null> {
  const { error } = await db.from('reports').delete().eq('memory_id', memoryId)
  return error ? json(500, { error: error.message }) : null
}

export function createAdminActionHandler(deps: ModerationDeps) {
  return async (req: Request): Promise<Response> => {
    const denied = await requireAdmin(deps, req)
    if (denied) return denied

    const parsed = actionSchema.safeParse(await parseBody(req))
    if (!parsed.success) return json(400, { error: 'invalid request' })
    const { memoryId, action, acknowledge } = parsed.data

    if (action === 'hide') {
      // Through the channel like every other path, so the operator's hand is
      // labelled 'operator' — and so hiding a moment that is already down
      // cannot repaint why it went down (docs/00 D55).
      const { data, error } = await deps.db.rpc('hide_memory', {
        p_memory_id: memoryId,
        p_reason: 'operator',
      })
      if (error) return json(500, { error: error.message })
      // Stale queue snapshot — no row answered. Telling the operator a moment
      // was taken down when nothing was touched is the same lie `unhide`
      // refuses to tell below.
      if (!firstRow<{ matched: boolean }>(data)?.matched) {
        return json(404, { error: 'not found' })
      }
    } else if (action === 'unhide') {
      const { data, error } = await deps.db.rpc('restore_memory', {
        p_memory_id: memoryId,
        p_acknowledge: acknowledge ?? null,
      })
      if (error) return json(500, { error: error.message })
      const result = firstRow<{ outcome: string; reason: string | null }>(data)
      // 409, not 403: the operator may do this — but only by saying what they
      // are overruling. The console turns this into a question; a console that
      // never asks simply cannot restore these rows, which is the whole point
      // of the gate living here instead of in the browser.
      if (result?.outcome === 'confirm') {
        return json(409, { error: 'confirm required', reason: result.reason })
      }
      // Stale queue snapshot — the row is gone. Saying "ok" would be a lie.
      if (!result || result.outcome === 'missing') return json(404, { error: 'not found' })
    } else if (action === 'delete') {
      // Media refs must be read before the row goes — with the row deleted
      // the object is unreachable (nothing else stores the key).
      const { data: memory } = await deps.db
        .from('memories')
        .select('media_url, thumb_url')
        .eq('id', memoryId)
        .maybeSingle()
      const { error } = await deps.db.from('memories').delete().eq('id', memoryId)
      if (error) return json(500, { error: error.message })
      // Row first (taking content down must not depend on storage being up);
      // object delete is best-effort — a failure just leaves an orphan.
      for (const url of [memory?.media_url, memory?.thumb_url]) {
        if (!url) continue
        const key = deps.storage.keyForUrl(url)
        if (!key) continue
        try {
          await deps.storage.deleteObject(key)
        } catch (err) {
          console.error(`admin delete: media object cleanup failed for ${key}`, err)
        }
      }
    } else {
      // dismiss: keep the moment up, clear its reports (the "OK" key — docs/15 §5)
      const failure = await clearReports(deps.db, memoryId)
      if (failure) return failure
    }
    // hide/unhide/delete changed how many moments are live; dismiss didn't, but
    // dropping a 60s cache entry costs one query — not worth branching on.
    try {
      deps.revalidate(COUNTERS_TAG)
    } catch {
      // the action already succeeded; a stale count is not worth a 500
    }
    return json(200, { ok: true })
  }
}

export function adminEmailsFromEnv(): string[] {
  return (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
}
