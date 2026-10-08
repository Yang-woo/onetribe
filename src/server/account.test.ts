import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, test } from 'vitest'
import { COUNTERS_TAG } from '@/lib/cache-tags'
import { createAccountDeleteHandler } from './account'

// Handler-level tests with a stub client — the real-stack path (cascades,
// FK nulling) lives in tests/db/account-api.test.ts. What matters here is
// the operator guard: the passport delete button acts on whatever session
// is signed in, so an ADMIN_EMAILS account must bounce off with 403 before
// anything destructive runs.

function stubDeps({ email }: { email?: string }) {
  const calls = { anonymized: 0, deleted: 0 }
  const db = {
    auth: {
      getUser: async (token: string) =>
        token === 'valid'
          ? { data: { user: { id: 'user-1', email } }, error: null }
          : { data: { user: null }, error: { message: 'invalid token' } },
      admin: {
        deleteUser: async () => {
          calls.deleted += 1
          return { error: null }
        },
      },
    },
    from: () => ({
      update: () => ({
        eq: async () => {
          calls.anonymized += 1
          return { error: null }
        },
      }),
    }),
  }
  const revalidated: string[] = []
  const revalidate = (tag: string) => void revalidated.push(tag)
  return { db: db as unknown as SupabaseClient, calls, revalidate, revalidated }
}

function deleteRequest(token?: string): Request {
  return new Request('http://localhost/api/account/delete', {
    method: 'POST',
    headers: token ? { authorization: `Bearer ${token}` } : {},
  })
}

describe('account delete operator guard', () => {
  test('an ADMIN_EMAILS account gets 403 and nothing is touched', async () => {
    const { db, calls, revalidate } = stubDeps({ email: 'op@onetribe.world' })
    const handler = createAccountDeleteHandler({
      db,
      revalidate,
      adminEmails: ['op@onetribe.world'],
    })
    const res = await handler(deleteRequest('valid'))
    expect(res.status).toBe(403)
    expect(calls).toEqual({ anonymized: 0, deleted: 0 })
  })

  test('the guard matches case-insensitively (env list is lowercase)', async () => {
    const { db, calls, revalidate } = stubDeps({ email: 'Op@OneTribe.World' })
    const handler = createAccountDeleteHandler({
      db,
      revalidate,
      adminEmails: ['op@onetribe.world'],
    })
    const res = await handler(deleteRequest('valid'))
    expect(res.status).toBe(403)
    expect(calls.deleted).toBe(0)
  })

  test('a regular email account still deletes (anonymize then deleteUser)', async () => {
    const { db, calls, revalidate } = stubDeps({ email: 'fan@example.com' })
    const handler = createAccountDeleteHandler({
      db,
      revalidate,
      adminEmails: ['op@onetribe.world'],
    })
    const res = await handler(deleteRequest('valid'))
    expect(res.status).toBe(200)
    expect(calls).toEqual({ anonymized: 1, deleted: 1 })
  })

  test('an anonymous passport (no email) is never blocked by the guard', async () => {
    const { db, calls, revalidate } = stubDeps({ email: undefined })
    const handler = createAccountDeleteHandler({
      db,
      revalidate,
      adminEmails: ['op@onetribe.world'],
    })
    const res = await handler(deleteRequest('valid'))
    expect(res.status).toBe(200)
    expect(calls.deleted).toBe(1)
  })

  // docs/00 D62: moment pages are cached and print author_name/author_link.
  // Without the drop, an erased name stays on every page the account posted.
  test('anonymizing drops the moment-page cache; a refused delete does not', async () => {
    const fan = stubDeps({ email: 'fan@example.com' })
    await createAccountDeleteHandler({
      db: fan.db,
      revalidate: fan.revalidate,
      adminEmails: ['op@onetribe.world'],
    })(deleteRequest('valid'))
    expect(fan.revalidated).toEqual([COUNTERS_TAG])

    const op = stubDeps({ email: 'op@onetribe.world' })
    await createAccountDeleteHandler({
      db: op.db,
      revalidate: op.revalidate,
      adminEmails: ['op@onetribe.world'],
    })(deleteRequest('valid'))
    expect(op.revalidated).toEqual([])
  })

  test('a cache that throws does not undo a completed erasure', async () => {
    const { db, calls } = stubDeps({ email: 'fan@example.com' })
    const res = await createAccountDeleteHandler({
      db,
      revalidate: () => {
        throw new Error('cache down')
      },
      adminEmails: [],
    })(deleteRequest('valid'))
    expect(res.status).toBe(200)
    expect(calls).toEqual({ anonymized: 1, deleted: 1 })
  })

  test('no token still 401s before any guard logic', async () => {
    const { db, calls, revalidate } = stubDeps({ email: 'op@onetribe.world' })
    const handler = createAccountDeleteHandler({
      db,
      revalidate,
      adminEmails: ['op@onetribe.world'],
    })
    const res = await handler(deleteRequest())
    expect(res.status).toBe(401)
    expect(calls).toEqual({ anonymized: 0, deleted: 0 })
  })
})
