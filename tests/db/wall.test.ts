import { afterAll, beforeAll, expect, test } from 'vitest'
import { createAnonClient, createServiceClient, eventIdByYear, seedMemory } from './helpers'

/**
 * Wall data layer — docs/17 T2.5/T3.5.
 * Counters must only ever count live rows, and the realtime feed must
 * deliver new live moments to anon subscribers WITHOUT the takedown_token
 * (publication column list — REST column grants don't cover realtime).
 */

const service = createServiceClient()
const anon = createAnonClient()

let eventId: string
const fixtureIds: string[] = []

async function insertMemory(caption: string, status: 'live' | 'hidden'): Promise<string> {
  const id = await seedMemory(service, {
    event_id: eventId,
    caption,
    origin_country: 'KR',
    status,
  })
  fixtureIds.push(id)
  return id
}

beforeAll(async () => {
  eventId = await eventIdByYear(service, 2022)
})

afterAll(async () => {
  await service.from('memories').delete().in('id', fixtureIds)
  await anon.removeAllChannels()
})

test('wall_counters counts live rows only and distinct countries', async () => {
  const { data: before } = await anon.from('wall_counters').select('moments, countries').single()

  await insertMemory('wall-live-1', 'live')
  await insertMemory('wall-live-2', 'live')
  await insertMemory('wall-hidden', 'hidden')

  const { data: after, error } = await anon
    .from('wall_counters')
    .select('moments, countries')
    .single()
  expect(error).toBeNull()
  expect(after!.moments).toBe(before!.moments + 2) // hidden row is not counted
  expect(after!.countries).toBeGreaterThanOrEqual(1)
})

test('realtime delivers new live moments to anon without takedown_token', async () => {
  const received: Record<string, unknown>[] = []

  const channel = anon.channel('wall-test')
  await new Promise<void>((resolve, reject) => {
    channel
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'memories' },
        (payload) => {
          received.push(payload.new as Record<string, unknown>)
        },
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') resolve()
        if (status === 'CHANNEL_ERROR') reject(new Error('realtime subscribe failed'))
      })
  })

  // Channel SUBSCRIBED ≠ postgres_changes registration complete — the DB-side
  // subscription lands asynchronously and changes before it are never
  // delivered. Probe with fresh inserts until one comes through.
  const probeIds: string[] = []
  await expect
    .poll(
      async () => {
        probeIds.push(await insertMemory(`wall-realtime-${probeIds.length}`, 'live'))
        return received.some((row) => probeIds.includes(row.id as string))
      },
      { timeout: 20_000, interval: 1_500 },
    )
    .toBe(true)

  const liveRow = received.find((row) => probeIds.includes(row.id as string))!
  expect(liveRow.caption).toMatch(/^wall-realtime-/)
  expect('takedown_token' in liveRow).toBe(false) // publication column list holds
})
