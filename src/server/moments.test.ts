import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, test, vi } from 'vitest'
import { COUNTERS_TAG } from '@/lib/cache-tags'
import { createMomentRemoveHandler } from './moments'

/**
 * /api/memories/remove — the passport's "remove this moment" (docs/00 —
 * self-delete). Handler-level: what the gate lets through and what the write
 * is *scoped to*. The real-stack proof that another passport's moment survives
 * is tests/db/moment-remove.test.ts.
 *
 * The stub records the filters the update was narrowed by, because the whole
 * safety property here is a WHERE clause: drop `.eq('author_id', …)` and every
 * test below still passes on the happy path while the route becomes a way to
 * take down anyone's moment.
 */

function stubDeps({ rows = [{ id: 'm-1' }], error = null as { message: string } | null } = {}) {
  const filters: Record<string, unknown> = {}
  const calls = { updates: 0, revalidated: [] as string[] }
  const db = {
    auth: {
      getUser: async (token: string) =>
        token === 'valid'
          ? { data: { user: { id: 'user-1' } }, error: null }
          : { data: { user: null }, error: { message: 'invalid token' } },
    },
    from: () => ({
      update: (patch: Record<string, unknown>) => {
        calls.updates += 1
        Object.assign(filters, { __patch: patch })
        const chain = {
          eq: (column: string, value: unknown) => {
            filters[column] = value
            return chain
          },
          select: async () => ({ data: error ? null : rows, error }),
        }
        return chain
      },
    }),
  }
  return {
    deps: {
      db: db as unknown as SupabaseClient,
      revalidate: (tag: string) => calls.revalidated.push(tag),
    },
    filters,
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

describe('moment self-removal', () => {
  test('hides the moment and drops the wall counter cache', async () => {
    const { deps, filters, calls } = stubDeps()
    const res = await createMomentRemoveHandler(deps)(
      removeRequest({ memoryId: '11111111-1111-4111-8111-111111111111' }, 'valid'),
    )
    expect(res.status).toBe(200)
    expect(filters.__patch).toEqual({ status: 'hidden' })
    // the count on the wall header drops by one — without this the moment
    // disappears while the header still counts it (docs/00 D41)
    expect(calls.revalidated).toEqual([COUNTERS_TAG])
  })

  test('the write is scoped to BOTH the id and the calling passport', async () => {
    const { deps, filters } = stubDeps()
    await createMomentRemoveHandler(deps)(
      removeRequest({ memoryId: '11111111-1111-4111-8111-111111111111' }, 'valid'),
    )
    // ownership is part of the statement, not a prior read: no window between
    // checking the author and hiding the row
    expect(filters.id).toBe('11111111-1111-4111-8111-111111111111')
    expect(filters.author_id).toBe('user-1')
  })

  test('someone else’s moment reads as 404, not 403', async () => {
    // the scoped update matched nothing — which is also what a bogus id does
    const { deps, calls } = stubDeps({ rows: [] })
    const res = await createMomentRemoveHandler(deps)(
      removeRequest({ memoryId: '22222222-2222-4222-8222-222222222222' }, 'valid'),
    )
    expect(res.status).toBe(404)
    // a 403 would confirm that id exists and belongs to someone
    expect(await res.json()).toEqual({ error: 'not found' })
    // and nothing was invalidated for a removal that never happened
    expect(calls.revalidated).toEqual([])
  })

  test('no bearer token → 401 before anything is written', async () => {
    const { deps, calls } = stubDeps()
    const res = await createMomentRemoveHandler(deps)(
      removeRequest({ memoryId: '11111111-1111-4111-8111-111111111111' }),
    )
    expect(res.status).toBe(401)
    expect(calls.updates).toBe(0)
  })

  test('an unrecognized token → 401 before anything is written', async () => {
    const { deps, calls } = stubDeps()
    const res = await createMomentRemoveHandler(deps)(
      removeRequest({ memoryId: '11111111-1111-4111-8111-111111111111' }, 'forged'),
    )
    expect(res.status).toBe(401)
    expect(calls.updates).toBe(0)
  })

  test.each([
    ['a missing id', {}],
    ['a non-uuid id', { memoryId: 'not-a-uuid' }],
    ['an id of the wrong type', { memoryId: 42 }],
  ])('%s → 400 before anything is written', async (_label, body) => {
    const { deps, calls } = stubDeps()
    const res = await createMomentRemoveHandler(deps)(removeRequest(body, 'valid'))
    expect(res.status).toBe(400)
    expect(calls.updates).toBe(0)
  })

  test('a database failure is a 500 and does not claim success', async () => {
    const { deps, calls } = stubDeps({ error: { message: 'connection reset' } })
    const res = await createMomentRemoveHandler(deps)(
      removeRequest({ memoryId: '11111111-1111-4111-8111-111111111111' }, 'valid'),
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
    })(removeRequest({ memoryId: '11111111-1111-4111-8111-111111111111' }, 'valid'))
    expect(res.status).toBe(200)
  })
})
