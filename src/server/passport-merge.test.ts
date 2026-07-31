import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, test } from 'vitest'
import { sourceTokenHash } from '@/lib/server/passport-merge-record'
import { createPassportMergeHandler } from './passport-merge'

/**
 * Handler-level tests with a stub client — the real-stack path (author_id
 * reassignment, attendance dedup, cascade delete) lives in
 * tests/db/passport-merge.test.ts. What matters here is the security gate —
 * you may only absorb an ANONYMOUS source, proven by its own token, and the
 * destructive delete must never run for a source that fails a guard — plus the
 * shape of each write, which a stub CAN prove.
 *
 * The stub records columns, filters and payloads rather than accepting any
 * call, because the dangerous mutations here are the ones that still look
 * right: an unscoped reassign (`.eq` dropped) is a wall-wide re-home, and a
 * stamp carried without created_at silently rewrites its date. A stub that
 * ignores arguments passes both (code review 2026-08-01).
 */

interface Profile {
  display_name: string | null
  instagram: string | null
  home_country: string | null
}

interface Op {
  table: string
  op: 'select' | 'update' | 'upsert'
  columns?: string
  filters: [string, unknown][]
  payload?: unknown
}

interface StubConfig {
  users: Record<string, { id: string; is_anonymous: boolean } | undefined>
  stamps?: { event_id: string; created_at: string }[]
  profiles?: Record<string, Profile>
  /** merges already recorded for the target in the last hour */
  recentMerges?: number
  /** `table:op` to fail, e.g. 'attendance:upsert' */
  failOn?: string
}

function stubDeps(config: StubConfig) {
  const calls = {
    ops: [] as Op[],
    deleted: [] as string[],
    alerts: [] as string[],
  }
  const opsOn = (table: string, op: Op['op']) =>
    calls.ops.filter((o) => o.table === table && o.op === op)
  const filterOf = (op: Op, column: string) => op.filters.find(([c]) => c === column)?.[1]

  function builder(table: string) {
    const op: Op = { table, op: 'select', filters: [] }
    let counting = false
    const settle = (single: boolean) => {
      calls.ops.push(op)
      const error = config.failOn === `${table}:${op.op}` ? { message: 'boom' } : null
      if (counting) return { count: config.recentMerges ?? 0, error }
      if (table === 'attendance' && op.op === 'select') {
        return { data: config.stamps ?? [], error }
      }
      if (table === 'profiles' && op.op === 'select') {
        const id = filterOf(op, 'id') as string
        return { data: (single ? config.profiles?.[id] : null) ?? null, error }
      }
      return { data: null, error }
    }
    const chain = {
      select(columns?: string, options?: { count?: string; head?: boolean }) {
        op.columns = columns
        counting = options?.head === true
        return chain
      },
      update(payload: unknown) {
        op.op = 'update'
        op.payload = payload
        return chain
      },
      upsert(payload: unknown) {
        op.op = 'upsert'
        op.payload = payload
        return chain
      },
      eq(column: string, value: unknown) {
        op.filters.push([column, value])
        return chain
      },
      gte(column: string, value: unknown) {
        op.filters.push([column, value])
        return chain
      },
      maybeSingle: async () => settle(true),
      then(resolve: (value: unknown) => void) {
        return resolve(settle(false))
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
          calls.ops.push({ table: 'auth', op: 'update', filters: [['id', id]] })
          calls.deleted.push(id)
          return { error: config.failOn === 'auth:delete' ? { message: 'boom' } : null }
        },
      },
    },
    from: builder,
  }
  const notify = async (message: { content?: string }) => {
    calls.alerts.push(message.content ?? '')
  }
  return { db: db as unknown as SupabaseClient, notify, calls, opsOn, filterOf }
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
const EMPTY_PROFILE: Profile = { display_name: null, instagram: null, home_country: null }

describe('passport merge handler — guards', () => {
  test('no bearer → 401, nothing touched', async () => {
    const { db, notify, calls } = stubDeps({ users: {} })
    const res = await createPassportMergeHandler({ db, notify })(
      mergeRequest(undefined, { anonToken: 'x' }),
    )
    expect(res.status).toBe(401)
    expect(calls.deleted).toEqual([])
    expect(calls.ops).toEqual([])
  })

  test('missing anonToken → 400', async () => {
    const { db, notify, calls } = stubDeps({ users: { 'target-tok': TARGET } })
    const res = await createPassportMergeHandler({ db, notify })(mergeRequest('target-tok', {}))
    expect(res.status).toBe(400)
    expect(calls.deleted).toEqual([])
  })

  test('unresolvable anonToken → 401, nothing touched', async () => {
    const { db, notify, calls } = stubDeps({ users: { 'target-tok': TARGET } })
    const res = await createPassportMergeHandler({ db, notify })(
      mergeRequest('target-tok', { anonToken: 'garbage' }),
    )
    expect(res.status).toBe(401)
    expect(calls.deleted).toEqual([])
    expect(calls.ops).toEqual([])
  })

  test('a NON-anonymous source is refused (403) and never deleted', async () => {
    // holding a real account's token must not let you fold it in and delete it
    const realOther = { id: 'other-real', is_anonymous: false }
    const { db, notify, calls } = stubDeps({
      users: { 'target-tok': TARGET, 'other-tok': realOther },
    })
    const res = await createPassportMergeHandler({ db, notify })(
      mergeRequest('target-tok', { anonToken: 'other-tok' }),
    )
    expect(res.status).toBe(403)
    expect(calls.deleted).toEqual([])
    expect(calls.ops).toEqual([])
  })

  test('an ANONYMOUS target is refused (403) — a throwaway can never absorb', async () => {
    // both sides anonymous: this is not the sign-in flow, it just hard-deletes
    // one live device session in favour of another (code review 2026-08-01).
    const otherAnon = { id: 'anon-2', is_anonymous: true }
    const { db, notify, calls } = stubDeps({
      users: { 'anon-tok': ANON, 'other-anon-tok': otherAnon },
    })
    const res = await createPassportMergeHandler({ db, notify })(
      mergeRequest('anon-tok', { anonToken: 'other-anon-tok' }),
    )
    expect(res.status).toBe(403)
    expect(calls.deleted).toEqual([])
    expect(calls.ops).toEqual([])
  })

  test('the same session on both sides is refused, never deleted', async () => {
    // A session can't absorb itself from either side: as an anonymous bearer it
    // fails the target guard, as a real one it fails the source guard. Both
    // paths must leave it alive — the caller is still using it.
    const {
      db: anonDb,
      notify: anonNotify,
      calls: anonCalls,
    } = stubDeps({
      users: { 'self-anon': ANON },
    })
    const anonRes = await createPassportMergeHandler({ db: anonDb, notify: anonNotify })(
      mergeRequest('self-anon', { anonToken: 'self-anon' }),
    )
    expect(anonRes.status).toBe(403)
    expect(anonCalls.deleted).toEqual([])

    const { db, notify, calls } = stubDeps({ users: { 'self-real': TARGET } })
    const res = await createPassportMergeHandler({ db, notify })(
      mergeRequest('self-real', { anonToken: 'self-real' }),
    )
    expect(res.status).toBe(403)
    expect(calls.deleted).toEqual([])
    expect(calls.ops).toEqual([])
  })

  test('over the per-account ceiling → 429, nothing touched', async () => {
    const { db, notify, calls, opsOn } = stubDeps({
      users: { 'target-tok': TARGET, 'anon-tok': ANON },
      recentMerges: 10,
    })
    const res = await createPassportMergeHandler({ db, notify })(
      mergeRequest('target-tok', { anonToken: 'anon-tok' }),
    )
    expect(res.status).toBe(429)
    expect(calls.deleted).toEqual([])
    // the ceiling is per ACCOUNT, not per IP — a shared festival address must
    // never cost someone else their passport
    const [ceiling] = opsOn('passport_merges', 'select')
    expect(ceiling.filters[0]).toEqual(['target_id', 'target-1'])
    expect(opsOn('memories', 'update')).toEqual([])
  })
})

describe('passport merge handler — the fold', () => {
  const happyConfig = (): StubConfig => ({
    users: { 'target-tok': TARGET, 'anon-tok': ANON },
    stamps: [
      { event_id: 'e-2018', created_at: '2018-06-24T00:00:00Z' },
      { event_id: 'e-2020', created_at: '2020-06-28T00:00:00Z' },
    ],
    profiles: { 'anon-1': EMPTY_PROFILE, 'target-1': EMPTY_PROFILE },
  })

  test('reassigns to the target, carries stamps, deletes the source, answers {ok:true}', async () => {
    const { db, notify, calls, opsOn } = stubDeps(happyConfig())
    const res = await createPassportMergeHandler({ db, notify })(
      mergeRequest('target-tok', { anonToken: 'anon-tok' }),
    )
    expect(res.status).toBe(200)
    // no counts: the caller reads res.ok only, and a stamp count would lie
    // (the upsert silently skips editions the target already had)
    expect(await res.json()).toEqual({ ok: true })

    const [reassign] = opsOn('memories', 'update')
    expect(reassign.payload).toEqual({ author_id: 'target-1' })
    // SCOPED to the source. Without this filter the statement re-homes every
    // moment on the wall, and every other assertion here still passes.
    expect(reassign.filters).toEqual([['author_id', 'anon-1']])

    const [stampWrite] = opsOn('attendance', 'upsert')
    // created_at travels with the stamp — a carried stamp keeps the day it was
    // earned instead of resetting to the day the passports merged
    expect(stampWrite.payload).toEqual([
      { profile_id: 'target-1', event_id: 'e-2018', created_at: '2018-06-24T00:00:00Z' },
      { profile_id: 'target-1', event_id: 'e-2020', created_at: '2020-06-28T00:00:00Z' },
    ])
    const [stampRead] = opsOn('attendance', 'select')
    expect(stampRead.columns).toBe('event_id, created_at')
    expect(stampRead.filters).toEqual([['profile_id', 'anon-1']])

    expect(calls.deleted).toEqual(['anon-1'])
    expect(calls.alerts).toEqual([])
  })

  test('records the pairing — with the token fingerprint — BEFORE anything moves', async () => {
    const { db, notify, calls, opsOn } = stubDeps(happyConfig())
    await createPassportMergeHandler({ db, notify })(
      mergeRequest('target-tok', { anonToken: 'anon-tok' }),
    )

    const [record] = opsOn('passport_merges', 'upsert')
    expect(record.payload).toEqual({
      source_id: 'anon-1',
      target_id: 'target-1',
      source_token_sha256: sourceTokenHash('anon-tok'),
    })
    // The record is the only thing that outlives the source: an upload still in
    // flight presents that token after the delete, and a failed merge leaves
    // nothing else to recover from. Written last, it would cover neither.
    const recordAt = calls.ops.indexOf(record)
    const movedAt = calls.ops.indexOf(opsOn('memories', 'update')[0])
    const deletedAt = calls.ops.findIndex((o) => o.table === 'auth')
    expect(recordAt).toBeLessThan(movedAt)
    expect(recordAt).toBeLessThan(deletedAt)
  })

  test('carries the identity typed on this device into the empty target fields', async () => {
    const { db, notify, opsOn } = stubDeps({
      ...happyConfig(),
      profiles: {
        'anon-1': { display_name: 'this device', instagram: 'raver', home_country: 'NL' },
        'target-1': { display_name: 'account owner', instagram: null, home_country: null },
      },
    })
    await createPassportMergeHandler({ db, notify })(
      mergeRequest('target-tok', { anonToken: 'anon-tok' }),
    )
    // fill-empty (docs/00 D30): the target's own name wins, the fields it never
    // had are taken from the passport about to be destroyed
    const [identity] = opsOn('profiles', 'update')
    expect(identity.payload).toEqual({ instagram: 'raver', home_country: 'NL' })
    expect(identity.filters).toEqual([['id', 'target-1']])
  })

  test('leaves a complete target identity alone', async () => {
    const { db, notify, opsOn } = stubDeps({
      ...happyConfig(),
      profiles: {
        'anon-1': { display_name: 'this device', instagram: 'raver', home_country: 'NL' },
        'target-1': { display_name: 'account owner', instagram: 'owner', home_country: 'KR' },
      },
    })
    await createPassportMergeHandler({ db, notify })(
      mergeRequest('target-tok', { anonToken: 'anon-tok' }),
    )
    expect(opsOn('profiles', 'update')).toEqual([])
  })

  test('a mid-merge fault alerts the operator and leaves the record behind', async () => {
    // nobody else finds out: the caller swallows this response by contract, and
    // the anonymous token it would retry with is already gone from storage.
    const { db, notify, calls, opsOn } = stubDeps({ ...happyConfig(), failOn: 'attendance:upsert' })
    const res = await createPassportMergeHandler({ db, notify })(
      mergeRequest('target-tok', { anonToken: 'anon-tok' }),
    )
    expect(res.status).toBe(500)
    expect(calls.alerts).toHaveLength(1)
    expect(calls.alerts[0]).toContain('anon-1')
    expect(calls.alerts[0]).toContain('target-1')
    expect(calls.alerts[0]).toContain('stamps')
    // the source survives a failed merge — deleting it would destroy the only
    // session that can prove ownership on a retry
    expect(calls.deleted).toEqual([])
    expect(opsOn('passport_merges', 'upsert')).toHaveLength(1)
  })

  test('a failed delete still alerts — the merge looks done but the ghost remains', async () => {
    const { db, notify, calls } = stubDeps({ ...happyConfig(), failOn: 'auth:delete' })
    const res = await createPassportMergeHandler({ db, notify })(
      mergeRequest('target-tok', { anonToken: 'anon-tok' }),
    )
    expect(res.status).toBe(500)
    expect(calls.alerts[0]).toContain('delete')
  })
})
