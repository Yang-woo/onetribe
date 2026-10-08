import type { SupabaseClient } from '@supabase/supabase-js'
import { COUNTERS_TAG } from '@/lib/cache-tags'
import { json, requireBearerUser } from '@/lib/server/http'

/**
 * Self-service account deletion (docs/00 D16, GDPR erasure). The bearer
 * token is the gate — a user can only destroy themselves. Moments stay on
 * the wall (each has its own takedown link) but are anonymized first:
 * author_name/author_link are personal data, author_id nulls via FK.
 * Operator accounts are refused: the passport's delete button acts on
 * whatever session is signed in, admin included (docs/00 D16 review
 * warning — and it happened for real on 2026-07-25).
 */

export interface AccountDeps {
  db: SupabaseClient // service role
  adminEmails: string[] // lowercase — these accounts must outlive the button
  revalidate: (tag: string) => void
}

export function createAccountDeleteHandler(deps: AccountDeps) {
  return async (req: Request): Promise<Response> => {
    const auth = await requireBearerUser(deps.db, req)
    if (auth.denied) return auth.denied
    const userId = auth.user.id

    const email = auth.user.email?.toLowerCase()
    if (email && deps.adminEmails.includes(email)) {
      return json(403, { error: 'operator accounts cannot self-delete' })
    }

    // Anonymize before deleteUser — after it, author_id is already null
    // (FK set null) and these rows can no longer be found.
    const { error: anonymizeError } = await deps.db
      .from('memories')
      .update({ author_name: null, author_link: null })
      .eq('author_id', userId)
    if (anonymizeError) return json(500, { error: 'could not delete account' })
    // Moment pages are cached (docs/00 D62) and print the name and handle just
    // erased — drop them, or the erasure stays invisible until the next upload.
    // Best-effort like the other drop sites: the rows are already anonymized.
    try {
      deps.revalidate(COUNTERS_TAG)
    } catch {
      // the cache refills from the anonymized rows on its next drop
    }

    // profiles/attendance cascade away with the auth user.
    const { error: deleteError } = await deps.db.auth.admin.deleteUser(userId)
    if (deleteError) return json(500, { error: 'could not delete account' })
    return json(200, { ok: true })
  }
}
