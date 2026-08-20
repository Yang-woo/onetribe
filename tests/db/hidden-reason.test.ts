import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createAdminActionHandler } from '@/server/admin'
import { createMomentRemoveHandler } from '@/server/moments'
import type { StorageAdapter } from '@/lib/storage'
import {
  createAnonClient,
  createServiceClient,
  eventIdByYear,
  memoryState,
  seedMemory,
} from './helpers'

/**
 * Provenance on a hidden row — docs/00 D55.
 *
 * Four paths hide a moment and they used to be indistinguishable afterwards,
 * which is what made an author's deliberate removal look like a filter mistake
 * in the operator console. Each path must now leave its own mark, and the marks
 * only mean something if they are *different* — so this suite drives all four
 * against the real database rather than asserting each one in isolation.
 *
 * The trigger and the RPC are the interesting cases: they write from inside the
 * database, where no amount of TypeScript can be checked.
 */

const service = createServiceClient()
const anon = createAnonClient()

const noStorage = {
  deleteObject: async () => {},
  keyForUrl: () => null,
} as unknown as StorageAdapter

const OPERATOR = `op-${randomUUID().slice(0, 8)}@onetribe.world`
const adminAction = createAdminActionHandler({
  db: service,
  adminEmails: [OPERATOR],
  storage: noStorage,
  revalidate: () => {},
})
const removeOwn = createMomentRemoveHandler({ db: service, revalidate: () => {} })

let eventId: string
let operatorToken: string
const memoryIds: string[] = []
const userIds: string[] = []

async function newPassport(name: string) {
  const client = createAnonClient()
  const { data, error } = await client.auth.signInAnonymously()
  if (error || !data.user || !data.session) throw new Error(`passport: ${error?.message}`)
  userIds.push(data.user.id)
  await service.from('profiles').insert({ id: data.user.id, display_name: name })
  return { userId: data.user.id, token: data.session.access_token }
}

async function seed(overrides: Record<string, unknown> = {}) {
  const id = await seedMemory(service, {
    event_id: eventId,
    caption: `reason-${randomUUID().slice(0, 8)}`,
    ...overrides,
  })
  memoryIds.push(id)
  return id
}

function adminRequest(memoryId: string, action: string): Request {
  return new Request('http://localhost/api/admin/action', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${operatorToken}` },
    body: JSON.stringify({ memoryId, action }),
  })
}

/** Trip the 3-distinct-reporter auto-hide (docs/09 A-2). */
async function reportThreeTimes(memoryId: string) {
  for (const hint of ['a', 'b', 'c']) {
    const { error } = await service
      .from('reports')
      .insert({ memory_id: memoryId, reason: 'spam', reporter_hint: `${hint}-${memoryId}` })
    if (error) throw new Error(`report fixture: ${error.message}`)
  }
}

beforeAll(async () => {
  eventId = await eventIdByYear(service, 2022)
  const password = `op-${randomUUID()}`
  const { data, error } = await service.auth.admin.createUser({
    email: OPERATOR,
    password,
    email_confirm: true,
  })
  if (error || !data.user) throw new Error(`operator fixture: ${error?.message}`)
  userIds.push(data.user.id)
  const { data: auth } = await createAnonClient().auth.signInWithPassword({
    email: OPERATOR,
    password,
  })
  operatorToken = auth.session!.access_token
})

afterAll(async () => {
  if (memoryIds.length) await service.from('memories').delete().in('id', memoryIds)
  for (const id of userIds) await service.auth.admin.deleteUser(id).catch(() => {})
})

describe('hidden_reason — each path signs its own work', () => {
  test('the author removing their own moment records "owner"', async () => {
    const owner = await newPassport('reason-owner')
    const memoryId = await seed({ author_id: owner.userId })

    const res = await removeOwn(
      new Request('http://localhost/api/memories/remove', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${owner.token}` },
        body: JSON.stringify({ memoryId }),
      }),
    )
    expect(res.status).toBe(200)
    expect(await memoryState(service, memoryId)).toEqual({
      status: 'hidden',
      hidden_reason: 'owner',
    })
  })

  test('the takedown token records "token", not "owner"', async () => {
    const memoryId = await seed()
    const { data } = await service
      .from('memories')
      .select('takedown_token')
      .eq('id', memoryId)
      .single()

    const { data: ok } = await anon.rpc('takedown_memory', {
      p_memory_id: memoryId,
      p_token: data!.takedown_token,
    })
    expect(ok).toBe(true)
    // the two uploader-driven paths stay distinguishable: only one of them
    // proves who is holding the link
    expect(await memoryState(service, memoryId)).toEqual({
      status: 'hidden',
      hidden_reason: 'token',
    })
  })

  test('the report threshold records "report"', async () => {
    const memoryId = await seed()
    await reportThreeTimes(memoryId)
    expect(await memoryState(service, memoryId)).toEqual({
      status: 'hidden',
      hidden_reason: 'report',
    })
  })

  test('the operator hiding by hand records "operator"', async () => {
    const memoryId = await seed()
    expect((await adminAction(adminRequest(memoryId, 'hide'))).status).toBe(200)
    expect(await memoryState(service, memoryId)).toEqual({
      status: 'hidden',
      hidden_reason: 'operator',
    })
  })

  test('restoring clears the reason along with the status', async () => {
    const owner = await newPassport('reason-restore')
    const memoryId = await seed({ author_id: owner.userId })
    await removeOwn(
      new Request('http://localhost/api/memories/remove', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${owner.token}` },
        body: JSON.stringify({ memoryId }),
      }),
    )

    expect((await adminAction(adminRequest(memoryId, 'unhide'))).status).toBe(200)
    // a live row still labelled "the author removed this" would be a lie, and
    // the next hide writes its own reason anyway
    expect(await memoryState(service, memoryId)).toEqual({ status: 'live', hidden_reason: null })
  })

  test('a later report does not relabel a moment its author already took down', async () => {
    const owner = await newPassport('reason-relabel')
    const memoryId = await seed({ author_id: owner.userId })
    await removeOwn(
      new Request('http://localhost/api/memories/remove', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${owner.token}` },
        body: JSON.stringify({ memoryId }),
      }),
    )

    // the trigger's `status = 'live'` guard is what protects this: without it
    // the mark that earns the confirmation prompt would be overwritten by any
    // three passers-by, and the console would offer the one-keypress restore
    await reportThreeTimes(memoryId)
    expect(await memoryState(service, memoryId)).toEqual({
      status: 'hidden',
      hidden_reason: 'owner',
    })
  })

  test('rows hidden before the column existed read as unknown, not as a value', async () => {
    // a straight status flip, the way every path worked until now
    const memoryId = await seed()
    await service.from('memories').update({ status: 'hidden' }).eq('id', memoryId)
    expect(await memoryState(service, memoryId)).toEqual({
      status: 'hidden',
      hidden_reason: null,
    })
  })

  test('the column refuses a reason nobody defined', async () => {
    const memoryId = await seed()
    // the four names are a closed set — a typo in a future write site must fail
    // loudly here rather than quietly disable the operator's confirmation
    const { error } = await service
      .from('memories')
      .update({ status: 'hidden', hidden_reason: 'whoops' })
      .eq('id', memoryId)
    expect(error?.code).toBe('23514')
  })
})
