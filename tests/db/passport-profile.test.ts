import { afterAll, describe, expect, test } from 'vitest'
import { createSupabasePassportBackend } from '@/lib/passport/backend'
import { createAnonClient, createServiceClient } from './helpers'

/**
 * Passport profile edit write path (docs/00 D30, D31). Unlike the upload
 * write-back (which only fills empty fields), the passport editor is a full
 * replace: a blanked field CLEARS the saved value. This goes through the
 * anonymous-auth browser client, so RLS is the boundary — the backend can only
 * touch its own row. Verified against real local Supabase with the anon key
 * (docs/00 D8).
 */

const service = createServiceClient()
const userIds: string[] = []

afterAll(async () => {
  for (const id of userIds) await service.auth.admin.deleteUser(id)
})

describe('backend.updateProfile (passport edit, RLS write path)', () => {
  test('upserts a row-less anonymous passport, trims, validates country, then clears blanks', async () => {
    const anonClient = createAnonClient()
    const { data: auth } = await anonClient.auth.signInAnonymously()
    const uid = auth.user!.id
    userIds.push(uid)
    const backend = createSupabasePassportBackend(anonClient)

    // This anonymous passport never ran start(), so it has NO profile row yet —
    // updateProfile must create it (upsert), not fail on a missing row. Country
    // is normalized to an ISO code (lowercase in → upper-case stored, D31).
    const saved = await backend.updateProfile({
      displayName: '  Raver  ',
      instagram: 'raver_01',
      country: 'nl',
    })
    expect(saved).toEqual({ displayName: 'Raver', instagram: 'raver_01', homeCountry: 'NL' })

    const { data: created } = await service
      .from('profiles')
      .select('display_name, instagram, home_country')
      .eq('id', uid)
      .single()
    expect(created).toEqual({ display_name: 'Raver', instagram: 'raver_01', home_country: 'NL' })

    // Blanking clears to null (full replace, not merge) — how a user removes a
    // saved handle/country. An invalid country also clears (never stores junk).
    const cleared = await backend.updateProfile({
      displayName: 'Raver',
      instagram: '   ',
      country: 'not-a-country',
    })
    expect(cleared.instagram).toBeNull()
    expect(cleared.homeCountry).toBeNull()
    const { data: after } = await service
      .from('profiles')
      .select('display_name, instagram, home_country')
      .eq('id', uid)
      .single()
    expect(after).toEqual({ display_name: 'Raver', instagram: null, home_country: null })
  })

  test('RLS keeps the write to the caller — one passport cannot edit another', async () => {
    const clientA = createAnonClient()
    const clientB = createAnonClient()
    const { data: authA } = await clientA.auth.signInAnonymously()
    const { data: authB } = await clientB.auth.signInAnonymously()
    const uidA = authA.user!.id
    const uidB = authB.user!.id
    userIds.push(uidA, uidB)

    await createSupabasePassportBackend(clientA).updateProfile({
      displayName: 'A',
      instagram: 'a_ig',
      country: 'nl',
    })
    await createSupabasePassportBackend(clientB).updateProfile({
      displayName: 'B',
      instagram: 'b_ig',
      country: 'de',
    })

    // direct cross-tenant attempt: B tries to overwrite A's row — owner-scoped
    // RLS blocks it, so 0 rows change (RLS is column-agnostic → home_country too).
    const { data: hijacked } = await clientB
      .from('profiles')
      .update({ home_country: 'FR' })
      .eq('id', uidA)
      .select()
    expect(hijacked).toEqual([])

    // A's row is untouched — B only ever wrote B's row (home_country included).
    const { data: rowA } = await service
      .from('profiles')
      .select('display_name, instagram, home_country')
      .eq('id', uidA)
      .single()
    expect(rowA).toEqual({ display_name: 'A', instagram: 'a_ig', home_country: 'NL' })
  })
})
