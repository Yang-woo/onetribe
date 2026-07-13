import { afterAll, beforeAll, expect, test } from 'vitest'
import {
  createAnonClient,
  createServiceClient,
  eventIdByYear,
  memoryStatus,
  seedMemory,
} from './helpers'

/**
 * Report threshold trigger — docs/17 T1.3, docs/00 D9 P2.
 * 3 distinct reporter_hints auto-hide a live memory. This is the safety
 * net that makes instant publishing (D7) survivable for a solo operator.
 */

const service = createServiceClient()
const anon = createAnonClient()

let eventId: string
const fixtureIds: string[] = []

async function createLiveMemory(label: string): Promise<string> {
  const id = await seedMemory(service, { event_id: eventId, caption: label })
  fixtureIds.push(id)
  return id
}

// Reports insert via the service role here (fixtures) — clients go through
// the server route, which computes the hint (see upload-api.test.ts). The
// trigger fires on insert regardless of role.
async function report(memoryId: string, hint: string | null) {
  return service
    .from('reports')
    .insert({ memory_id: memoryId, reason: 'spam', reporter_hint: hint })
}

async function statusOf(memoryId: string): Promise<string> {
  return memoryStatus(service, memoryId)
}

beforeAll(async () => {
  eventId = await eventIdByYear(service, 2019)
})

afterAll(async () => {
  await service.from('memories').delete().in('id', fixtureIds)
})

test('stays live below the threshold (2 distinct reporters)', async () => {
  const id = await createLiveMemory('threshold-below')
  await report(id, 'hint-1')
  await report(id, 'hint-2')
  expect(await statusOf(id)).toBe('live')
})

test('duplicate reporter_hint counts once', async () => {
  const id = await createLiveMemory('threshold-dupe')
  await report(id, 'hint-1')
  await report(id, 'hint-2')
  await report(id, 'hint-2')
  await report(id, 'hint-2')
  expect(await statusOf(id)).toBe('live')
})

test('3rd distinct reporter hides the memory', async () => {
  const id = await createLiveMemory('threshold-hit')
  await report(id, 'hint-1')
  await report(id, 'hint-2')
  expect(await statusOf(id)).toBe('live')
  await report(id, 'hint-3')
  expect(await statusOf(id)).toBe('hidden')
})

test('null reporter_hint does not count toward the threshold', async () => {
  const id = await createLiveMemory('threshold-null')
  await report(id, null)
  await report(id, null)
  await report(id, 'hint-1')
  await report(id, 'hint-2')
  expect(await statusOf(id)).toBe('live')
  await report(id, 'hint-3')
  expect(await statusOf(id)).toBe('hidden')
})

test('an already-hidden memory stays hidden and never flips back', async () => {
  const id = await createLiveMemory('threshold-hidden')
  await service.from('memories').update({ status: 'hidden' }).eq('id', id)
  const { error } = await report(id, 'hint-1')
  expect(error).toBeNull()
  await report(id, 'hint-2')
  await report(id, 'hint-3')
  await report(id, 'hint-4')
  expect(await statusOf(id)).toBe('hidden')
})

test('auto-hidden memories disappear from anon reads immediately (RLS tie-in)', async () => {
  const id = await createLiveMemory('threshold-rls')
  await report(id, 'hint-1')
  await report(id, 'hint-2')
  await report(id, 'hint-3')
  const { data } = await anon.from('memories').select('id').eq('id', id)
  expect(data ?? []).toHaveLength(0)
})
