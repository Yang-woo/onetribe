import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createSupabasePassportBackend } from '@/lib/passport/backend'
import { createMomentRemoveHandler } from '@/server/moments'
import {
  createAnonClient,
  createServiceClient,
  eventIdByYear,
  memoryStatus,
  seedMemory,
} from './helpers'

/**
 * /api/memories/remove against the real stack — the passport's standing way to
 * take down its own moment (docs/00 D54). Two things can only be
 * proven here, not against a stub:
 *
 *  1. the scoped UPDATE really does refuse another passport's moment, and
 *  2. a removed moment leaves the *reader's* world — `memories_read_live`
 *     drops it from the wall and from the owner's own passport, which is what
 *     makes a soft hide feel like a delete to the person who asked for one.
 *
 * Both RLS assertions go through the anon-key client (docs/00 D8).
 */

const service = createServiceClient()
const handler = createMomentRemoveHandler({ db: service, revalidate: () => {} })

let eventId: string
const memoryIds: string[] = []
const userIds: string[] = []

/** A signed-in anonymous passport with a profile row (memories.author_id → profiles). */
async function newPassport(displayName: string) {
  const client = createAnonClient()
  const { data, error } = await client.auth.signInAnonymously()
  if (error || !data.user || !data.session) throw new Error(`passport fixture: ${error?.message}`)
  userIds.push(data.user.id)
  await service.from('profiles').insert({ id: data.user.id, display_name: displayName })
  return { client, userId: data.user.id, token: data.session.access_token }
}

async function seedOwned(userId: string, caption: string) {
  const id = await seedMemory(service, { event_id: eventId, caption, author_id: userId })
  memoryIds.push(id)
  return id
}

function removeRequest(memoryId: string, token?: string): Request {
  return new Request('http://localhost/api/memories/remove', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ memoryId }),
  })
}

beforeAll(async () => {
  eventId = await eventIdByYear(service, 2023)
})

afterAll(async () => {
  if (memoryIds.length) await service.from('memories').delete().in('id', memoryIds)
  for (const id of userIds) await service.auth.admin.deleteUser(id).catch(() => {})
})

describe('passport self-removal', () => {
  test('the owner takes their own moment down, and it leaves every public read', async () => {
    const owner = await newPassport('owner')
    const memoryId = await seedOwned(owner.userId, `own-${randomUUID().slice(0, 8)}`)
    // a second moment the owner keeps: without it, "the removed id is absent"
    // also passes for a passport that returns no moments at all
    const keeperId = await seedOwned(owner.userId, `keeper-${randomUUID().slice(0, 8)}`)

    // it starts out visible to the world and to its owner's passport
    const anon = createAnonClient()
    const before = await anon.from('memories').select('id').eq('id', memoryId).maybeSingle()
    expect(before.data?.id).toBe(memoryId)

    const res = await handler(removeRequest(memoryId, owner.token))
    expect(res.status).toBe(200)

    // hidden, not deleted — the operator can still audit and restore (docs/09 C)
    expect(await memoryStatus(service, memoryId)).toBe('hidden')
    const after = await anon.from('memories').select('id').eq('id', memoryId).maybeSingle()
    expect(after.data).toBeNull()
    // and gone from the owner's own passport, so the grid can't offer a thumb
    // whose permalink is dead
    const state = await createSupabasePassportBackend(owner.client).load()
    expect(state?.moments.map((m) => m.id)).toEqual([keeperId])
  })

  test('a token the real auth server does not know is refused', async () => {
    const owner = await newPassport('token-check')
    const memoryId = await seedOwned(owner.userId, `token-${randomUUID().slice(0, 8)}`)
    // the unit suite proves this against a stub; this proves the stub matches
    // what GoTrue actually does with junk and with no header at all
    expect((await handler(removeRequest(memoryId, 'not-a-jwt'))).status).toBe(401)
    expect((await handler(removeRequest(memoryId))).status).toBe(401)
    expect(await memoryStatus(service, memoryId)).toBe('live')
  })

  test('another passport cannot take it down', async () => {
    const owner = await newPassport('owner')
    const stranger = await newPassport('stranger')
    const memoryId = await seedOwned(owner.userId, `victim-${randomUUID().slice(0, 8)}`)

    const res = await handler(removeRequest(memoryId, stranger.token))
    expect(res.status).toBe(404)
    // the safety property: a valid session on someone else's id is inert
    expect(await memoryStatus(service, memoryId)).toBe('live')
  })

  test('an unattributed moment answers to nobody', async () => {
    // uploads from before D43 (and rows whose owner deleted their account)
    // carry author_id = null; the takedown_token link is their only way down
    const caller = await newPassport('caller')
    const orphanId = await seedMemory(service, {
      event_id: eventId,
      caption: `orphan-${randomUUID().slice(0, 8)}`,
    })
    memoryIds.push(orphanId)

    const res = await handler(removeRequest(orphanId, caller.token))
    expect(res.status).toBe(404)
    expect(await memoryStatus(service, orphanId)).toBe('live')
  })

  test('removing twice is not an error (a double-tap is not a broken link)', async () => {
    const owner = await newPassport('double')
    const memoryId = await seedOwned(owner.userId, `twice-${randomUUID().slice(0, 8)}`)

    expect((await handler(removeRequest(memoryId, owner.token))).status).toBe(200)
    expect((await handler(removeRequest(memoryId, owner.token))).status).toBe(200)
    expect(await memoryStatus(service, memoryId)).toBe('hidden')
  })

  test('the browser backend posts a real session token and reports failure', async () => {
    const owner = await newPassport('via-backend')
    const memoryId = await seedOwned(owner.userId, `backend-${randomUUID().slice(0, 8)}`)
    const backend = createSupabasePassportBackend(owner.client)

    // Route the backend's fetch at the handler — this is the client contract
    // (the bearer it attaches, the body it sends) meeting the real gate. Only
    // the app's own relative path is intercepted: the handler itself calls
    // GoTrue over fetch to resolve the bearer, and swallowing that would feed
    // the route back into itself and 401 every request.
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) =>
      typeof input === 'string' && input.startsWith('/api/')
        ? handler(new Request(`http://localhost${input}`, init))
        : originalFetch(input, init)) as unknown as typeof fetch
    try {
      await expect(backend.removeMoment(memoryId)).resolves.toBeUndefined()
      expect(await memoryStatus(service, memoryId)).toBe('hidden')

      // a moment that isn't this passport's must reject, not resolve quietly —
      // the passport grid drops the thumb only on a resolved promise
      const other = await newPassport('someone else')
      const theirs = await seedOwned(other.userId, `theirs-${randomUUID().slice(0, 8)}`)
      await expect(backend.removeMoment(theirs)).rejects.toThrow(/404/)
      expect(await memoryStatus(service, theirs)).toBe('live')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
