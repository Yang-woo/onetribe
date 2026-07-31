import type { SupabaseClient } from '@supabase/supabase-js'
import { json, parseBody, requireBearerUser } from '@/lib/server/http'

/**
 * Fold an anonymous passport into the account the user just signed into
 * (docs/00 D44). A device that had no session (incognito, cleared storage, a
 * different machine) mints a fresh anonymous passport the moment it uploads
 * (D43); signing into an existing account from there would otherwise strand
 * that upload. This route reassigns the anonymous passport's moments/stamps to
 * the target, then deletes it.
 *
 * Two proofs of ownership, both required (this is the whole security model):
 *  - the TARGET from this request's bearer (requireBearerUser),
 *  - the anonymous SOURCE from its own access token in the body — holding that
 *    token is the only proof the caller owns it, so a passing uuid can't claim
 *    someone else's uploads.
 * The source must be anonymous: you can absorb a throwaway passport, never fold
 * in (and delete) a real account. All writes go through the service role — no
 * anon/authenticated write policies exist on these tables (D9 P1).
 */

export interface PassportMergeDeps {
  db: SupabaseClient // service role
}

interface MergeBody {
  anonToken: string
}

function readBody(body: unknown): MergeBody | null {
  if (!body || typeof body !== 'object') return null
  const anonToken = (body as { anonToken?: unknown }).anonToken
  if (typeof anonToken !== 'string' || anonToken.length === 0) return null
  return { anonToken }
}

export function createPassportMergeHandler(deps: PassportMergeDeps) {
  return async (req: Request): Promise<Response> => {
    // ── target: the account being signed into ──
    const auth = await requireBearerUser(deps.db, req)
    if (auth.denied) return auth.denied
    const targetId = auth.user.id

    const body = readBody(await parseBody(req))
    if (!body) return json(400, { error: 'anonToken required' })

    // ── source: the anonymous passport this device is leaving behind ──
    const { data: srcData, error: srcError } = await deps.db.auth.getUser(body.anonToken)
    if (srcError || !srcData.user) return json(401, { error: 'invalid source session' })
    const source = srcData.user
    // Absorb ONLY an anonymous throwaway — never fold in (and delete) a real
    // account, even if the caller somehow holds its token.
    if (!source.is_anonymous) return json(403, { error: 'source is not anonymous' })
    // The token resolved to the target itself — nothing to merge.
    if (source.id === targetId) return json(200, { ok: true, memories: 0, stamps: 0 })

    // Guarantee the target has a profile row for the author_id FK, without
    // clobbering an existing identity (same pattern as the upload path).
    const { error: profileError } = await deps.db
      .from('profiles')
      .upsert({ id: targetId }, { onConflict: 'id', ignoreDuplicates: true })
    if (profileError) return json(500, { error: 'could not merge passport' })

    // 1) Reassign uploads. Only ownership moves — author_name/author_link stay
    //    as posted, so wall credit is unchanged and the moment now lives in the
    //    target's passport. MUST run before the delete below, or the author_id
    //    FK (set null) would strand these rows.
    const { data: moved, error: memError } = await deps.db
      .from('memories')
      .update({ author_id: targetId })
      .eq('author_id', source.id)
      .select('id')
    if (memError) return json(500, { error: 'could not merge passport' })

    // 2) Carry stamps over, skipping editions the target already has (the
    //    attendance PK is (profile_id, event_id), so a plain reassign would
    //    collide). The source's own rows cascade away with it below.
    const { data: stamps, error: readStampsError } = await deps.db
      .from('attendance')
      .select('event_id')
      .eq('profile_id', source.id)
    if (readStampsError) return json(500, { error: 'could not merge passport' })
    if (stamps && stamps.length > 0) {
      const { error: stampError } = await deps.db.from('attendance').upsert(
        stamps.map((row) => ({ profile_id: targetId, event_id: row.event_id })),
        { onConflict: 'profile_id,event_id', ignoreDuplicates: true },
      )
      if (stampError) return json(500, { error: 'could not merge passport' })
    }

    // 3) Delete the now-empty anonymous source. Its profile and any leftover
    //    attendance cascade; its memories already moved, so none null out.
    const { error: deleteError } = await deps.db.auth.admin.deleteUser(source.id)
    if (deleteError) return json(500, { error: 'could not merge passport' })

    return json(200, { ok: true, memories: moved?.length ?? 0, stamps: stamps?.length ?? 0 })
  }
}
