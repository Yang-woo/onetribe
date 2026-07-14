import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { json, parseBody } from '@/lib/server/http'
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

async function requireAdmin(deps: AdminDeps, req: Request): Promise<Response | null> {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return json(401, { error: 'sign in required' })
  const { data, error } = await deps.db.auth.getUser(token)
  const email = data.user?.email?.toLowerCase()
  if (error || !email) return json(401, { error: 'sign in required' })
  if (!deps.adminEmails.includes(email)) return json(403, { error: 'not an operator' })
  return null
}

// Admin reads use the service role — includes hidden rows on purpose
// (that's the job) but never takedown_token (nothing here needs it).
const ADMIN_MEMORY_COLUMNS =
  'id, caption, media_url, thumb_url, media_kind, embed_url, status, author_name, origin_country, created_at'

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
})

export function createAdminActionHandler(deps: AdminDeps) {
  return async (req: Request): Promise<Response> => {
    const denied = await requireAdmin(deps, req)
    if (denied) return denied

    const parsed = actionSchema.safeParse(await parseBody(req))
    if (!parsed.success) return json(400, { error: 'invalid request' })
    const { memoryId, action } = parsed.data

    if (action === 'hide' || action === 'unhide') {
      const { error } = await deps.db
        .from('memories')
        .update({ status: action === 'hide' ? 'hidden' : 'live' })
        .eq('id', memoryId)
      if (error) return json(500, { error: error.message })
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
      const { error } = await deps.db.from('reports').delete().eq('memory_id', memoryId)
      if (error) return json(500, { error: error.message })
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
