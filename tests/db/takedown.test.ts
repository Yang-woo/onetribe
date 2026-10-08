import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { COUNTERS_TAG } from '@/lib/cache-tags'
import { createTakedown } from '@/server/takedown'
import { createAnonClient, createServiceClient, eventIdByYear, memoryStatus } from './helpers'

/**
 * Takedown RPC — docs/17 T1.5. One-click uploader self-removal via the
 * secret takedown_token (docs/02). The token itself is unreadable to anon
 * (see rls.test.ts), so possession of the link is the credential.
 */

const service = createServiceClient()
const anon = createAnonClient()

let memoryId: string
let token: string

beforeAll(async () => {
  const eventId = await eventIdByYear(service, 2019)
  const { data, error } = await service
    .from('memories')
    .insert({
      event_id: eventId,
      media_kind: 'image',
      media_url: 'https://example.com/takedown.jpg',
      caption: 'takedown-test',
      rights_confirmed: true,
      status: 'live',
    })
    .select('id, takedown_token')
    .single()
  if (error || !data) throw new Error(`fixture failed: ${error?.message}`)
  memoryId = data.id
  token = data.takedown_token
})

afterAll(async () => {
  await service.from('memories').delete().eq('id', memoryId)
})

async function statusOf(id: string): Promise<string> {
  return memoryStatus(service, id)
}

// A WRONG token was tested from the start; a MISSING one never was, and that is
// the gap a rewrite of this RPC fell straight into: the token predicate became
// `p_token is null or takedown_token = p_token`, which a null makes vacuously
// true, so an anonymous caller could take any moment down with an id alone.
// Absent credentials are their own case — "not the right token" and "no token"
// fail for different reasons and only one of them was ever exercised.
test('a missing token takes nothing down', async () => {
  const { data, error } = await anon.rpc('takedown_memory', {
    p_memory_id: memoryId,
    p_token: null,
  })
  expect(error).toBeNull()
  expect(data).toBe(false)
  expect(await statusOf(memoryId)).toBe('live')
})

test('an invalid token changes nothing and reports failure', async () => {
  const { data, error } = await anon.rpc('takedown_memory', {
    p_memory_id: memoryId,
    p_token: randomUUID(),
  })
  expect(error).toBeNull()
  expect(data).toBe(false)
  expect(await statusOf(memoryId)).toBe('live')
})

test('the correct token hides the memory', async () => {
  const { data, error } = await anon.rpc('takedown_memory', {
    p_memory_id: memoryId,
    p_token: token,
  })
  expect(error).toBeNull()
  expect(data).toBe(true)
  expect(await statusOf(memoryId)).toBe('hidden')
})

test('a valid token is idempotent — already hidden still reports success', async () => {
  // The RPC is idempotent (migration 20260725000300): a matching token succeeds
  // even when the moment is already hidden, so a double-clicked takedown link
  // reads as "done", not "invalid". Only a wrong token returns false.
  const { data } = await anon.rpc('takedown_memory', {
    p_memory_id: memoryId,
    p_token: token,
  })
  expect(data).toBe(true)
  expect(await statusOf(memoryId)).toBe('hidden')
})

// docs/00 D62: the link's form action on the real RPC and the real anon client.
// The drop empties every cached moment page, and the RPC answers true for a
// moment already down — so replaying one link must drop once, on the takedown
// that took it down. The anon read is what tells them apart: RLS hides the row
// once it is down.
test('the link action drops the moment caches once, not on every replay', async () => {
  const eventId = await eventIdByYear(service, 2019)
  const { data, error } = await service
    .from('memories')
    .insert({
      event_id: eventId,
      media_kind: 'image',
      media_url: `https://example.com/takedown-replay-${randomUUID()}.jpg`,
      caption: 'takedown-replay-test',
      rights_confirmed: true,
      status: 'live',
    })
    .select('id, takedown_token')
    .single()
  if (error || !data) throw new Error(`fixture failed: ${error?.message}`)

  try {
    const dropped: string[] = []
    const takedown = createTakedown({ db: anon, revalidate: (tag) => dropped.push(tag) })

    expect(await takedown(data.id, randomUUID())).toBe('0')
    expect(dropped).toEqual([])

    expect(await takedown(data.id, data.takedown_token)).toBe('1')
    expect(dropped).toEqual([COUNTERS_TAG])

    expect(await takedown(data.id, data.takedown_token)).toBe('1')
    expect(dropped).toEqual([COUNTERS_TAG])
  } finally {
    await service.from('memories').delete().eq('id', data.id)
  }
})
