import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { createAnonClient, createServiceClient } from './helpers'

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
  const { data: event } = await service
    .from('events')
    .select('id')
    .eq('festival', 'Defqon.1')
    .eq('year', 2019)
    .single()

  const { data, error } = await service
    .from('memories')
    .insert({
      event_id: event!.id,
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
  const { data } = await service.from('memories').select('status').eq('id', id).single()
  return data!.status
}

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

test('repeat calls are no-ops once hidden', async () => {
  const { data } = await anon.rpc('takedown_memory', {
    p_memory_id: memoryId,
    p_token: token,
  })
  expect(data).toBe(false)
  expect(await statusOf(memoryId)).toBe('hidden')
})
