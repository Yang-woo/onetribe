import { afterAll, describe, expect, test } from 'vitest'
import { createSupabasePassportBackend } from '@/lib/passport/backend'
import { createAnonClient, createServiceClient, eventIdByYear, seedMemory } from './helpers'

/**
 * "My moments" ordering (docs/00 D37). The passport grid — and the ←/→ order of
 * the moment modal that now opens from it — is whatever this query returns, so
 * the order has to be total. created_at alone is not: a batch upload writes
 * several rows with one timestamp, and Postgres is then free to return them in
 * any order (and to change its mind between plans). Same (created_at, id) key
 * as the wall's keyset pagination. Verified against real local Supabase through
 * the anonymous browser client (docs/00 D8).
 */

const service = createServiceClient()
const userIds: string[] = []
const memoryIds: string[] = []

afterAll(async () => {
  if (memoryIds.length) await service.from('memories').delete().in('id', memoryIds)
  for (const id of userIds) await service.auth.admin.deleteUser(id)
})

describe('backend.load (my moments ordering)', () => {
  test('a batch sharing one created_at comes back in a stable, total order', async () => {
    const anonClient = createAnonClient()
    const { data: auth } = await anonClient.auth.signInAnonymously()
    const uid = auth.user!.id
    userIds.push(uid)

    // memories.author_id points at profiles, so the passport row has to exist
    await service.from('profiles').insert({ id: uid, display_name: 'batch uploader' })

    const eventId = await eventIdByYear(service, 2024)
    // one upload session: five photos, one timestamp
    const sameInstant = '2026-07-26T01:02:03.000Z'
    for (let i = 0; i < 5; i++) {
      memoryIds.push(
        await seedMemory(service, {
          event_id: eventId,
          caption: `batch-${i}`,
          author_id: uid,
          created_at: sameInstant,
        }),
      )
    }

    const backend = createSupabasePassportBackend(anonClient)
    const ids = (await backend.load())!.moments.map((m) => m.id)

    expect(ids).toHaveLength(5)
    // id descending is the tiebreaker; without it the five rows come back in an
    // arbitrary order, so the grid (and the modal's ←/→) would shuffle per load
    expect(ids).toEqual([...ids].sort((a, b) => b.localeCompare(a)))
  })
})
