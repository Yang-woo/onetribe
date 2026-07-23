import { afterAll, describe, expect, test } from 'vitest'
import { createSupabasePassportBackend } from '@/lib/passport/backend'
import { createAnonClient, createServiceClient } from './helpers'

/**
 * Passport profile edit write path (docs/00 D30). Unlike the upload write-back
 * (which only writes provided fields), the passport editor is a full replace:
 * a blanked field CLEARS the saved value. This goes through the anonymous-auth
 * browser client, so RLS is the boundary — the backend can only touch its own
 * row. Verified against real local Supabase with the anon key (docs/00 D8).
 */

const service = createServiceClient()
const userIds: string[] = []

afterAll(async () => {
  for (const id of userIds) await service.auth.admin.deleteUser(id)
})

describe('backend.updateProfile (passport edit, RLS write path)', () => {
  test('upserts a row-less anonymous passport, trims, then clears a blanked field', async () => {
    const anonClient = createAnonClient()
    const { data: auth } = await anonClient.auth.signInAnonymously()
    const uid = auth.user!.id
    userIds.push(uid)
    const backend = createSupabasePassportBackend(anonClient)

    // This anonymous passport never ran start(), so it has NO profile row yet —
    // updateProfile must create it (upsert), not fail on a missing row.
    const saved = await backend.updateProfile({ displayName: '  Raver  ', instagram: 'raver_01' })
    expect(saved).toEqual({ displayName: 'Raver', instagram: 'raver_01' }) // trimmed

    const { data: created } = await service
      .from('profiles')
      .select('display_name, instagram')
      .eq('id', uid)
      .single()
    expect(created).toEqual({ display_name: 'Raver', instagram: 'raver_01' })

    // Blanking the handle clears it to null (full replace, not merge) — the way
    // a user removes a saved handle from the passport.
    const cleared = await backend.updateProfile({ displayName: 'Raver', instagram: '   ' })
    expect(cleared.instagram).toBeNull()
    const { data: after } = await service
      .from('profiles')
      .select('display_name, instagram')
      .eq('id', uid)
      .single()
    expect(after).toEqual({ display_name: 'Raver', instagram: null })
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
    })
    await createSupabasePassportBackend(clientB).updateProfile({
      displayName: 'B',
      instagram: 'b_ig',
    })

    // B's edit only ever wrote B's row; A's is untouched (RLS owner scope).
    const { data: rowA } = await service
      .from('profiles')
      .select('display_name, instagram')
      .eq('id', uidA)
      .single()
    expect(rowA).toEqual({ display_name: 'A', instagram: 'a_ig' })
  })
})
