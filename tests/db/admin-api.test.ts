import { randomUUID } from 'node:crypto'
import { captionHash } from '@/lib/translate'
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

// Cache tags dropped by the handler — moderation moves the live count, which
// the wall header serves from a 60s cache (docs/00 D12).
const revalidated: string[] = []

function deps() {
  return {
    db: service,
    adminEmails: [OPERATOR.email.toLowerCase()],
    storage: fakeStorage,
    revalidate: (tag: string) => revalidated.push(tag),
  }
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

// A hidden fixture has to say WHY it is hidden: `restore_memory` refuses to put
// back a moment whose provenance was never recorded, the same way it refuses an
// author's own takedown (docs/00 D55). A bare `status: 'hidden'` is exactly the
// pre-migration row that refusal exists for.
async function createMemory(
  caption: string,
  status: 'live' | 'hidden' = 'live',
  hidden_reason: 'owner' | 'report' | 'operator' | 'token' | null = null,
) {
  const id = await seedMemory(service, { event_id: eventId, caption, status, hidden_reason })
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

  // Dropping `hidden_reason` from ADMIN_MEMORY_COLUMNS breaks the visible half
  // of D55 — every hidden row reads as `(unknown)` and every restore starts
  // demanding an acknowledgement — while leaving the units and the rest of this
  // suite green. Only the e2e journey noticed, and the e2e job does not run on
  // pull requests, so the failure would surface on main after the merge.
  test('the queue tells the operator why a hidden moment is down', async () => {
    const id = await createMemory(`admin-reason-${randomUUID().slice(0, 6)}`, 'hidden', 'owner')

    const res = await createAdminQueueHandler(deps())(withAuth(operatorToken))
    const body = await res.json()

    const row = body.recent.find((m: { id: string }) => m.id === id)
    expect(row).toMatchObject({ status: 'hidden', hidden_reason: 'owner' })
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

  // Hiding a moment lowers the live count the wall header shows from cache
  // (docs/00 D12), so moderation has to drop that cache like a publish does —
  // otherwise a moment taken down for a report is still counted for a minute.
  test('a moderation action drops the cached counters', async () => {
    const id = await createMemory(`admin-revalidate-${randomUUID().slice(0, 6)}`)
    const before = revalidated.length

    await createAdminActionHandler(deps())(
      withAuth(operatorToken, { memoryId: id, action: 'hide' }),
    )

    expect(revalidated.slice(before)).toContain('counters')
  })

  test('unhide clears the reports that hid it, so a single re-report cannot instantly re-hide it', async () => {
    const id = await createMemory(
      `admin-unhide-clear-${randomUUID().slice(0, 6)}`,
      'hidden',
      'report',
    )
    // the three distinct hints that tripped the auto-hide threshold sit on the row
    await service
      .from('reports')
      .insert(
        [1, 2, 3].map((n) => ({ memory_id: id, reason: 'nsfw', reporter_hint: `h${n}-${id}` })),
      )

    await createAdminActionHandler(deps())(
      withAuth(operatorToken, { memoryId: id, action: 'unhide' }),
    )

    const { data } = await service.from('memories').select('status').eq('id', id).single()
    expect(data!.status).toBe('live')
    // reports gone → the 3-strike counter resets; the next lone report can't re-hide
    const { count } = await service
      .from('reports')
      .select('*', { count: 'exact', head: true })
      .eq('memory_id', id)
    expect(count).toBe(0)
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

  test('delete erases the caption out of the translation cache too', async () => {
    // `translations` is keyed by a hash of the caption, not by memory id, and
    // anon can read it — so without this the translated caption keeps answering
    // in every language after the Memory is gone, which is exactly what privacy
    // §6 now promises it will not do.
    const caption = `admin-delete-cache-${randomUUID().slice(0, 6)}`
    const id = await createMemory(caption)
    const source_hash = captionHash(caption)
    await service.from('translations').insert([
      { source_hash, target_lang: 'ko', text: 'ko', provider: 'test' },
      { source_hash, target_lang: 'de', text: 'de', provider: 'test' },
    ])

    await createAdminActionHandler(deps())(
      withAuth(operatorToken, { memoryId: id, action: 'delete' }),
    )

    const { count } = await service
      .from('translations')
      .select('*', { count: 'exact', head: true })
      .eq('source_hash', source_hash)
    expect(count).toBe(0)
  })

  test('hide keeps the caption translations — it is reversible, and erasure is not', async () => {
    const caption = `admin-hide-cache-${randomUUID().slice(0, 6)}`
    const id = await createMemory(caption)
    const source_hash = captionHash(caption)
    await service
      .from('translations')
      .insert({ source_hash, target_lang: 'ko', text: 'ko', provider: 'test' })

    await createAdminActionHandler(deps())(
      withAuth(operatorToken, { memoryId: id, action: 'hide' }),
    )

    const { count } = await service
      .from('translations')
      .select('*', { count: 'exact', head: true })
      .eq('source_hash', source_hash)
    expect(count).toBe(1)
    await service.from('translations').delete().eq('source_hash', source_hash)
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
