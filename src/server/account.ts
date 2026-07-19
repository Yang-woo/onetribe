import type { SupabaseClient } from '@supabase/supabase-js'
import { json } from '@/lib/server/http'

/**
 * Self-service account deletion (docs/00 D16, GDPR erasure). The bearer
 * token is the gate — a user can only destroy themselves. Moments stay on
 * the wall (each has its own takedown link) but are anonymized first:
 * author_name/author_link are personal data, author_id nulls via FK.
 */

export interface AccountDeps {
  db: SupabaseClient // service role
}

export function createAccountDeleteHandler(deps: AccountDeps) {
  return async (req: Request): Promise<Response> => {
    const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    if (!token) return json(401, { error: 'sign in required' })
    const { data, error } = await deps.db.auth.getUser(token)
    if (error || !data.user) return json(401, { error: 'sign in required' })
    const userId = data.user.id

    // Anonymize before deleteUser — after it, author_id is already null
    // (FK set null) and these rows can no longer be found.
    const { error: anonymizeError } = await deps.db
      .from('memories')
      .update({ author_name: null, author_link: null })
      .eq('author_id', userId)
    if (anonymizeError) return json(500, { error: 'could not delete account' })

    // profiles/attendance cascade away with the auth user.
    const { error: deleteError } = await deps.db.auth.admin.deleteUser(userId)
    if (deleteError) return json(500, { error: 'could not delete account' })
    return json(200, { ok: true })
  }
}
