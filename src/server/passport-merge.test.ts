import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, test } from 'vitest'
import { createPassportMergeHandler } from './passport-merge'

/**
 * Handler-level tests with a stub client — the real-stack path (author_id
 * reassignment, attendance dedup, cascade delete) lives in
 * tests/db/passport-merge.test.ts. What matters here is the security gate:
 * you may only absorb an ANONYMOUS source, proven by its own token, and the
 * destructive delete must never run for a source that fails a guard.
 */

interface StubConfig {
  users: Record<string, { id: string; is_anonymous: boolean } | undefined>
  moved?: { id: string }[]
  stamps?: { event_id: string }[]
}

function stubDeps(config: StubConfig) {
  const calls = {
    reassignedTo: null as string | null,
    stampUpsert: null as { profile_id: string; event_id: string }[] | null,
    deleted: [] as string[],
    profileUpserts: 0,
  }
  function builder(table: string) {
    const state: { op?: string } = {}
    const chain = {
      update(payload: { author_id: string }) {
        state.op = 'update'
        if (table === 'memories') calls.reassignedTo = payload.author_id
        return chain
      },
      upsert(payload: unknown) {
        state.op = 'upsert'
        if (table === 'profiles') calls.profileUpserts += 1
        if (table === 'attendance')
          calls.stampUpsert = payload as { profile_id: string; event_id: string }[]
        return chain
      },
      select() {
        state.op ??= 'select'
        return chain
      },
      eq() {
        return chain
      },
      then(resolve: (value: { data: unknown; error: null }) => void) {
        if (table === 'memories' && state.op === 'update')
          return resolve({ data: config.moved ?? [], error: null })
        if (table === 'attendance' && state.op === 'select')
          return resolve({ data: config.stamps ?? [], error: null })
        return resolve({ data: [], error: null })
      },
    }
    return chain
  }
  const db = {
    auth: {
      getUser: async (token: string) => {
        const user = config.users[token]
        return user
          ? { data: { user }, error: null }
          : { data: { user: null }, error: { message: 'bad token' } }
      },
      admin: {
        deleteUser: async (id: string) => {
          calls.deleted.push(id)
          return { error: null }
        },
      },
    },
    from: builder,
  }
  return { db: db as unknown as SupabaseClient, calls }
}

function mergeRequest(bearer?: string, body?: unknown): Request {
  return new Request('http://localhost/api/passport/merge', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

const TARGET = { id: 'target-1', is_anonymous: false }
const ANON = { id: 'anon-1', is_anonymous: true }

describe('passport merge handler', () => {
  test('no bearer → 401, nothing touched', async () => {
    const { db, calls } = stubDeps({ users: {} })
    const res = await createPassportMergeHandler({ db })(
      mergeRequest(undefined, { anonToken: 'x' }),
    )
    expect(res.status).toBe(401)
    expect(calls.deleted).toEqual([])
    expect(calls.reassignedTo).toBeNull()
  })

  test('missing anonToken → 400', async () => {
    const { db, calls } = stubDeps({ users: { 'target-tok': TARGET } })
    const res = await createPassportMergeHandler({ db })(mergeRequest('target-tok', {}))
    expect(res.status).toBe(400)
    expect(calls.deleted).toEqual([])
  })

  test('unresolvable anonToken → 401, nothing touched', async () => {
    const { db, calls } = stubDeps({ users: { 'target-tok': TARGET } })
    const res = await createPassportMergeHandler({ db })(
      mergeRequest('target-tok', { anonToken: 'garbage' }),
    )
    expect(res.status).toBe(401)
    expect(calls.deleted).toEqual([])
    expect(calls.reassignedTo).toBeNull()
  })

  test('a NON-anonymous source is refused (403) and never deleted', async () => {
    // holding a real account's token must not let you fold it in and delete it
    const realOther = { id: 'other-real', is_anonymous: false }
    const { db, calls } = stubDeps({
      users: { 'target-tok': TARGET, 'other-tok': realOther },
    })
    const res = await createPassportMergeHandler({ db })(
      mergeRequest('target-tok', { anonToken: 'other-tok' }),
    )
    expect(res.status).toBe(403)
    expect(calls.deleted).toEqual([])
    expect(calls.reassignedTo).toBeNull()
  })

  test('an anonymous token resolving to the caller itself → 200 no-op', async () => {
    // bearer and anonToken are the same anonymous session — nothing to merge,
    // and the source must not be deleted out from under the caller.
    const { db, calls } = stubDeps({ users: { 'self-tok': ANON } })
    const res = await createPassportMergeHandler({ db })(
      mergeRequest('self-tok', { anonToken: 'self-tok' }),
    )
    expect(res.status).toBe(200)
    expect(calls.reassignedTo).toBeNull()
    expect(calls.deleted).toEqual([])
  })

  test('happy path: reassigns to target, dedup-upserts stamps, deletes source', async () => {
    const { db, calls } = stubDeps({
      users: { 'target-tok': TARGET, 'anon-tok': ANON },
      moved: [{ id: 'm1' }, { id: 'm2' }],
      stamps: [{ event_id: 'e-2018' }, { event_id: 'e-2020' }],
    })
    const res = await createPassportMergeHandler({ db })(
      mergeRequest('target-tok', { anonToken: 'anon-tok' }),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, memories: 2, stamps: 2 })
    // moments moved to the target, not left on the source
    expect(calls.reassignedTo).toBe('target-1')
    // the source's stamps are re-homed under the target (dedup handled by upsert)
    expect(calls.stampUpsert).toEqual([
      { profile_id: 'target-1', event_id: 'e-2018' },
      { profile_id: 'target-1', event_id: 'e-2020' },
    ])
    // the target's profile row is ensured for the FK, and the source is deleted
    expect(calls.profileUpserts).toBe(1)
    expect(calls.deleted).toEqual(['anon-1'])
  })
})
