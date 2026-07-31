import type { SupabaseClient } from '@supabase/supabase-js'
import { type DiscordNotifier, notifyDiscord } from '@/lib/server/discord'
import { json, parseBody, requireBearerUser } from '@/lib/server/http'
import { sourceTokenHash } from '@/lib/server/passport-merge-record'
import { fillEmptyIdentity } from '@/server/upload'

/**
 * Fold an anonymous passport into the account the user just signed into
 * (docs/00 D44). A device that had no session (incognito, cleared storage, a
 * different machine) mints a fresh anonymous passport the moment it uploads
 * (D43); signing into an existing account from there would otherwise strand
 * that upload. This route carries the anonymous passport's identity, moments
 * and stamps over to the target, then deletes it.
 *
 * Two proofs of ownership, both required (this is the whole security model):
 *  - the TARGET from this request's bearer (requireBearerUser),
 *  - the anonymous SOURCE from its own access token in the body — holding that
 *    token is the only proof the caller owns it, so a passing uuid can't claim
 *    someone else's uploads.
 * The source must be anonymous: you can absorb a throwaway passport, never fold
 * in (and delete) a real account. All writes go through the service role — no
 * anon/authenticated write policies exist on these tables (D9 P1).
 *
 * NOT atomic, and it can't be: the last step leaves the database (GoTrue). It
 * is idempotent and recorded instead — `passport_merges` is written before
 * anything moves, so a retry re-runs every step harmlessly and a failure leaves
 * evidence to finish from (docs/00 D45).
 */

export interface PassportMergeDeps {
  db: SupabaseClient // service role
  // Operator Discord alerts (docs/00 D36) — the caller swallows this route's
  // failures by contract, so this is the only thing that reports them.
  notify?: DiscordNotifier
}

/**
 * Merges per account per hour. Bounds the damage from a leaked bearer without
 * an IP counter: festival wifi puts a crowd behind one address, and a merge
 * refused there is a passport lost, not a request retried. One is the honest
 * number for a real user; ten leaves room for a retry storm.
 */
const MERGES_PER_HOUR = 10

function readAnonToken(body: unknown): string | null {
  const token = (body as { anonToken?: unknown } | null)?.anonToken
  return typeof token === 'string' && token.length > 0 ? token : null
}

export function createPassportMergeHandler(deps: PassportMergeDeps) {
  const notify = deps.notify ?? notifyDiscord
  return async (req: Request): Promise<Response> => {
    // ── target: the account being signed into ──
    const auth = await requireBearerUser(deps.db, req)
    if (auth.denied) return auth.denied
    const targetId = auth.user.id
    // Absorbing INTO a throwaway passport is never the sign-in flow this route
    // exists for — it would hard-delete one live device session in favour of
    // another. Only a real account can be a target.
    if (auth.user.is_anonymous) return json(403, { error: 'target is not an account' })

    const anonToken = readAnonToken(await parseBody(req))
    if (!anonToken) return json(400, { error: 'anonToken required' })

    // ── source: the anonymous passport this device is leaving behind ──
    const { data: srcData, error: srcError } = await deps.db.auth.getUser(anonToken)
    if (srcError || !srcData.user) return json(401, { error: 'invalid source session' })
    const source = srcData.user
    // Absorb ONLY an anonymous throwaway — never fold in (and delete) a real
    // account, even if the caller somehow holds its token.
    // (A token resolving to the caller itself needs no separate branch: the two
    // guards above already refuse it from whichever side it comes in on.)
    if (!source.is_anonymous) return json(403, { error: 'source is not anonymous' })

    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const { count: recent } = await deps.db
      .from('passport_merges')
      .select('*', { count: 'exact', head: true })
      .eq('target_id', targetId)
      .gte('created_at', hourAgo)
    if ((recent ?? 0) >= MERGES_PER_HOUR) {
      return json(429, { error: 'too many passport merges — try again later' })
    }

    // The one failure exit. Every step below is a separate round trip, so a
    // fault leaves a half-merged state that nobody would otherwise hear about:
    // the client swallows this response by contract, and the anonymous token it
    // would need to retry with is already gone from storage.
    const fail = async (step: string) => {
      await notify({
        content: `⚠️ passport merge failed at \`${step}\` — source \`${source.id}\` → target \`${targetId}\``,
      })
      return json(500, { error: 'could not merge passport' })
    }

    // Guarantee the target has a profile row for the author_id FK, without
    // clobbering an existing identity (same pattern as the upload path).
    const { error: profileError } = await deps.db
      .from('profiles')
      .upsert({ id: targetId }, { onConflict: 'id', ignoreDuplicates: true })
    if (profileError) return await fail('target-profile')

    // 1) Record the pairing BEFORE anything moves. This row outlives the source
    //    and is the only thing that can still speak for it: an upload already in
    //    flight on this device presents the source token after the delete below,
    //    and the publish path credits the target instead of dropping attribution
    //    (docs/00 D45). It doubles as the evidence trail for a failed merge.
    const { error: recordError } = await deps.db.from('passport_merges').upsert(
      {
        source_id: source.id,
        target_id: targetId,
        source_token_sha256: sourceTokenHash(anonToken),
      },
      { onConflict: 'source_id' },
    )
    if (recordError) return await fail('record')

    // 2) Carry the identity the user typed on THIS device into any field the
    //    target hasn't filled — the same fill-empty rule the upload path uses
    //    (docs/00 D30). The delete below destroys the source profile, and a
    //    target that was created by an upload may hold nothing at all, so
    //    skipping this silently loses a name/handle/country the user entered.
    const identityColumns = 'display_name, instagram, home_country'
    const [{ data: sourceProfile }, { data: targetProfile }] = await Promise.all([
      deps.db.from('profiles').select(identityColumns).eq('id', source.id).maybeSingle(),
      deps.db.from('profiles').select(identityColumns).eq('id', targetId).maybeSingle(),
    ])
    const carried = fillEmptyIdentity(targetProfile, {
      name: sourceProfile?.display_name ?? undefined,
      handle: sourceProfile?.instagram ?? undefined,
      country: sourceProfile?.home_country ?? undefined,
    })
    if (Object.keys(carried).length > 0) {
      const { error: identityError } = await deps.db
        .from('profiles')
        .update(carried)
        .eq('id', targetId)
      if (identityError) return await fail('identity')
    }

    // 3) Reassign uploads. Only ownership moves — author_name/author_link stay
    //    as posted, so wall credit is unchanged and the moment now lives in the
    //    target's passport. MUST run before the delete below, or the author_id
    //    FK (set null) would strand these rows.
    const { error: memError } = await deps.db
      .from('memories')
      .update({ author_id: targetId })
      .eq('author_id', source.id)
    if (memError) return await fail('memories')

    // 4) Carry stamps over, skipping editions the target already has (the
    //    attendance PK is (profile_id, event_id), so a plain reassign would
    //    collide). created_at travels with the row: a stamp keeps the day it
    //    was earned rather than resetting to the day the passports merged.
    //    The source's own rows cascade away with it below.
    const { data: stamps, error: readStampsError } = await deps.db
      .from('attendance')
      .select('event_id, created_at')
      .eq('profile_id', source.id)
    if (readStampsError) return await fail('stamps-read')
    if (stamps && stamps.length > 0) {
      const { error: stampError } = await deps.db.from('attendance').upsert(
        stamps.map((row) => ({
          profile_id: targetId,
          event_id: row.event_id,
          created_at: row.created_at,
        })),
        { onConflict: 'profile_id,event_id', ignoreDuplicates: true },
      )
      if (stampError) return await fail('stamps')
    }

    // 5) Delete the now-empty anonymous source. Its profile and any leftover
    //    attendance cascade; its memories already moved, so none null out.
    const { error: deleteError } = await deps.db.auth.admin.deleteUser(source.id)
    if (deleteError) return await fail('delete')

    // No counts: the only caller reads `res.ok` and nothing else, and a count of
    // carried stamps would be a lie anyway (the upsert silently skips editions
    // the target already had).
    return json(200, { ok: true })
  }
}
