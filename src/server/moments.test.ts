import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, test, vi } from 'vitest'
import { COUNTERS_TAG } from '@/lib/cache-tags'
import { createMomentRemoveHandler } from './moments'

/**
 * /api/memories/remove — the passport's "remove this moment" (docs/00 D54).
 * Handler-level: what the gate lets through, and what the write is *scoped to*.
 * The real-stack proof that another passport's moment survives is
 * tests/db/moment-remove.test.ts.
 *
 * The stub records the RPC arguments, because the whole safety property here is
 * one of them: drop `p_author_id` and every happy path below still passes while
 * the route becomes a way to take down anyone's moment. It also refuses to hand
 * out a query builder at all — going back to a direct `update` would slip out of
 * the one channel that owns `hidden_reason` (docs/00 D55), and that is a change
 * no assertion about arguments would notice.
 */

const CALLER = 'user-1'

function stubDeps({
  matched = true,
  reason = 'owner' as string | null,
  error = null as { message: string } | null,
} = {}) {
  const calls = {
    rpc: [] as Array<{ fn: string; args: Record<string, unknown> }>,
    revalidated: [] as string[],
  }
  const db = {
    auth: {
      getUser: async (token: string) =>
        token === 'valid'
          ? { data: { user: { id: CALLER } }, error: null }
          : { data: { user: null }, error: { message: 'invalid token' } },
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.rpc.push({ fn, args })
      return error ? { data: null, error } : { data: [{ matched, reason }], error: null }
    },
    from: (table: string) => {
      throw new Error(`removal must go through hide_memory, not a direct write to ${table}`)
    },
  }
  return {
    deps: {
      db: db as unknown as SupabaseClient,
      revalidate: (tag: string) => calls.revalidated.push(tag),
    },
    calls,
  }
}

function removeRequest(body: unknown, token?: string): Request {
  return new Request('http://localhost/api/memories/remove', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
}

const A_MOMENT = '11111111-1111-4111-8111-111111111111'

describe('moment self-removal', () => {
  test('hides the moment and drops the wall counter cache', async () => {
    const { deps, calls } = stubDeps()
    const res = await createMomentRemoveHandler(deps)(
      removeRequest({ memoryId: A_MOMENT }, 'valid'),
    )
    expect(res.status).toBe(200)
    expect(calls.rpc).toHaveLength(1)
    expect(calls.rpc[0].fn).toBe('hide_memory')
    // the reason travels with the status: an unlabelled hide reads as a filter
    // mistake in the operator console, one keypress from being undone (D55)
    expect(calls.rpc[0].args.p_reason).toBe('owner')
    // the count on the wall header drops by one — without this the moment
    // disappears while the header still counts it (docs/00 D41)
    expect(calls.revalidated).toEqual([COUNTERS_TAG])
  })

  test('the write is scoped to BOTH the id and the calling passport', async () => {
    const { deps, calls } = stubDeps()
    await createMomentRemoveHandler(deps)(removeRequest({ memoryId: A_MOMENT }, 'valid'))
    // ownership is an argument to the write, not a prior read: no window
    // between checking the author and hiding the row
    expect(calls.rpc[0].args.p_memory_id).toBe(A_MOMENT)
    expect(calls.rpc[0].args.p_author_id).toBe(CALLER)
  })

  test('someone else’s moment reads as 404, not 403', async () => {
    // the scoped write matched nothing — which is also what a bogus id does
    const { deps, calls } = stubDeps({ matched: false, reason: null })
    const res = await createMomentRemoveHandler(deps)(
      removeRequest({ memoryId: '22222222-2222-4222-8222-222222222222' }, 'valid'),
    )
    expect(res.status).toBe(404)
    // a 403 would confirm that id exists and belongs to someone
    expect(await res.json()).toEqual({ error: 'not found' })
    // and nothing was invalidated for a removal that never happened
    expect(calls.revalidated).toEqual([])
  })

  test('a moment that is already down still reads as removed', async () => {
    // Their moment, already hidden — by three reports, say. The channel keeps
    // the label it went down with and reports `matched`, so the owner is told
    // the truth ("it is off the wall") instead of "not found", and the console
    // still sees why it is down. A `matched === false` reading of "no row
    // changed" would turn this into a 404.
    const { deps } = stubDeps({ matched: true, reason: 'report' })
    const res = await createMomentRemoveHandler(deps)(
      removeRequest({ memoryId: A_MOMENT }, 'valid'),
    )
    expect(res.status).toBe(200)
  })

  test('no bearer token → 401 before anything is written', async () => {
    const { deps, calls } = stubDeps()
    const res = await createMomentRemoveHandler(deps)(removeRequest({ memoryId: A_MOMENT }))
    expect(res.status).toBe(401)
    expect(calls.rpc).toHaveLength(0)
  })

  test('an unrecognized token → 401 before anything is written', async () => {
    const { deps, calls } = stubDeps()
    const res = await createMomentRemoveHandler(deps)(
      removeRequest({ memoryId: A_MOMENT }, 'forged'),
    )
    expect(res.status).toBe(401)
    expect(calls.rpc).toHaveLength(0)
  })

  test.each([
    ['a missing id', {}],
    ['a non-uuid id', { memoryId: 'not-a-uuid' }],
    ['an id of the wrong type', { memoryId: 42 }],
  ])('%s → 400 before anything is written', async (_label, body) => {
    const { deps, calls } = stubDeps()
    const res = await createMomentRemoveHandler(deps)(removeRequest(body, 'valid'))
    expect(res.status).toBe(400)
    expect(calls.rpc).toHaveLength(0)
  })

  test('a database failure is a 500 and does not claim success', async () => {
    const { deps, calls } = stubDeps({ error: { message: 'connection reset' } })
    const res = await createMomentRemoveHandler(deps)(
      removeRequest({ memoryId: A_MOMENT }, 'valid'),
    )
    expect(res.status).toBe(500)
    // the moment is still up, so the cached count is still right
    expect(calls.revalidated).toEqual([])
  })

  test('the removal survives a failing cache invalidation', async () => {
    // the row is already hidden by the time revalidate runs — throwing a 500
    // here would tell the user it failed and invite a pointless retry
    const { deps } = stubDeps()
    const res = await createMomentRemoveHandler({
      ...deps,
      revalidate: vi.fn(() => {
        throw new Error('cache unreachable')
      }),
    })(removeRequest({ memoryId: A_MOMENT }, 'valid'))
    expect(res.status).toBe(200)
  })
})
