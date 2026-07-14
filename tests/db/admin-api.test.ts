import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createAdminActionHandler, createAdminQueueHandler } from '@/server/admin'
import type { StorageAdapter } from '@/lib/storage'
import { createAnonClient, createServiceClient, eventIdByYear, seedMemory } from './helpers'

/**
 * Admin routes — docs/17 T4.2, access model D9 P10. The allowlist gate is
 * the whole security story here (service role behind it), so the denial
 * paths matter as much as the actions.
 */

const service = createServiceClient()

const OPERATOR = {
  email: `op-${randomUUID().slice(0, 8)}@test.onetribe`,
  password: 'op-pass-12345',
}
const STRANGER = {
  email: `nobody-${randomUUID().slice(0, 8)}@test.onetribe`,
  password: 'no-pass-12345',
}

let operatorToken: string
let strangerToken: string
let eventId: string
const userIds: string[] = []
const fixtureIds: string[] = []

// Mirrors seedMemory's `https://media.test/<name>.jpg` URLs so the delete
// path can derive keys; records what it deletes for assertions.
const deletedKeys: string[] = []
const fakeStorage: StorageAdapter = {
  async presignUpload() {
    throw new Error('not used in admin tests')
  },
  publicUrl: (key) => `https://media.test/${key}`,
  keyForUrl: (url) => (url.startsWith('https://media.test/') ? url.slice(19) : null),
  async deleteObject(key) {
    deletedKeys.push(key)
  },
}

function deps() {
  return { db: service, adminEmails: [OPERATOR.email.toLowerCase()], storage: fakeStorage }
}

function withAuth(token?: string, body?: unknown): Request {
  return new Request('http://localhost/api/admin', {
    method: body ? 'POST' : 'GET',
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      'content-type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
}

async function createMemory(caption: string, status: 'live' | 'hidden' = 'live') {
  const id = await seedMemory(service, { event_id: eventId, caption, status })
  fixtureIds.push(id)
  return id
}

beforeAll(async () => {
  eventId = await eventIdByYear(service, 2018)

  for (const account of [OPERATOR, STRANGER]) {
    const { data, error } = await service.auth.admin.createUser({
      email: account.email,
      password: account.password,
      email_confirm: true,
    })
    if (error || !data.user) throw new Error(`user fixture: ${error?.message}`)
    userIds.push(data.user.id)
  }

  const client = createAnonClient()
  const { data: opAuth } = await client.auth.signInWithPassword(OPERATOR)
  operatorToken = opAuth.session!.access_token
  const stranger = createAnonClient()
  const { data: strangerAuth } = await stranger.auth.signInWithPassword(STRANGER)
  strangerToken = strangerAuth.session!.access_token
})

afterAll(async () => {
  await service.from('memories').delete().in('id', fixtureIds)
  for (const id of userIds) await service.auth.admin.deleteUser(id)
})

describe('access gate', () => {
  test('no token → 401, non-operator → 403, operator → 200', async () => {
    const queue = createAdminQueueHandler(deps())
    expect((await queue(withAuth())).status).toBe(401)
    expect((await queue(withAuth(strangerToken))).status).toBe(403)
    expect((await queue(withAuth(operatorToken))).status).toBe(200)
  })

  test('actions are gated the same way', async () => {
    const action = createAdminActionHandler(deps())
    const res = await action(withAuth(strangerToken, { memoryId: randomUUID(), action: 'hide' }))
    expect(res.status).toBe(403)
  })
})

describe('queue', () => {
  test('returns reported and recent moments with counters', async () => {
    const reportedId = await createMemory(`admin-reported-${randomUUID().slice(0, 6)}`)
    await service
      .from('reports')
      .insert({ memory_id: reportedId, reason: 'nsfw', reporter_hint: 'admin-test' })

    const res = await createAdminQueueHandler(deps())(withAuth(operatorToken))
    const body = await res.json()

    expect(
      body.reports.some((r: { memories: { id: string } }) => r.memories.id === reportedId),
    ).toBe(true)
    expect(body.recent.some((m: { id: string }) => m.id === reportedId)).toBe(true)
    expect(body.counters.openReports).toBeGreaterThanOrEqual(1)
  })
})

describe('actions', () => {
  test('hide takes a live memory off the wall; unhide restores it', async () => {
    const id = await createMemory(`admin-hide-${randomUUID().slice(0, 6)}`)
    const action = createAdminActionHandler(deps())

    await action(withAuth(operatorToken, { memoryId: id, action: 'hide' }))
    let { data } = await service.from('memories').select('status').eq('id', id).single()
    expect(data!.status).toBe('hidden')

    await action(withAuth(operatorToken, { memoryId: id, action: 'unhide' }))
    ;({ data } = await service.from('memories').select('status').eq('id', id).single())
    expect(data!.status).toBe('live')
  })

  test('dismiss clears reports but keeps the memory live', async () => {
    const id = await createMemory(`admin-dismiss-${randomUUID().slice(0, 6)}`)
    await service.from('reports').insert({ memory_id: id, reason: 'spam', reporter_hint: 'x' })

    await createAdminActionHandler(deps())(
      withAuth(operatorToken, { memoryId: id, action: 'dismiss' }),
    )

    const { count } = await service
      .from('reports')
      .select('*', { count: 'exact', head: true })
      .eq('memory_id', id)
    expect(count).toBe(0)
    const { data } = await service.from('memories').select('status').eq('id', id).single()
    expect(data!.status).toBe('live')
  })

  test('delete removes the memory (reports cascade) and its storage object', async () => {
    const caption = `admin-delete-${randomUUID().slice(0, 6)}`
    const id = await createMemory(caption)
    await service.from('reports').insert({ memory_id: id, reason: 'spam', reporter_hint: 'x' })

    await createAdminActionHandler(deps())(
      withAuth(operatorToken, { memoryId: id, action: 'delete' }),
    )

    const { data } = await service.from('memories').select('id').eq('id', id)
    expect(data ?? []).toHaveLength(0)
    const { count } = await service
      .from('reports')
      .select('*', { count: 'exact', head: true })
      .eq('memory_id', id)
    expect(count).toBe(0)
    // The media object went with the row (docs/00 D9-c — no orphan left behind).
    expect(deletedKeys).toContain(`${caption}.jpg`)
  })

  test('hide leaves the storage object alone (reversible action)', async () => {
    const caption = `admin-hide-keep-${randomUUID().slice(0, 6)}`
    const id = await createMemory(caption)

    await createAdminActionHandler(deps())(
      withAuth(operatorToken, { memoryId: id, action: 'hide' }),
    )

    expect(deletedKeys).not.toContain(`${caption}.jpg`)
  })
})
