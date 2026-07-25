import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, test } from 'vitest'
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
  return { db: db as unknown as SupabaseClient, calls }
}

function deleteRequest(token?: string): Request {
  return new Request('http://localhost/api/account/delete', {
    method: 'POST',
    headers: token ? { authorization: `Bearer ${token}` } : {},
  })
}

describe('account delete operator guard', () => {
  test('an ADMIN_EMAILS account gets 403 and nothing is touched', async () => {
    const { db, calls } = stubDeps({ email: 'op@onetribe.world' })
    const handler = createAccountDeleteHandler({ db, adminEmails: ['op@onetribe.world'] })
    const res = await handler(deleteRequest('valid'))
    expect(res.status).toBe(403)
    expect(calls).toEqual({ anonymized: 0, deleted: 0 })
  })

  test('the guard matches case-insensitively (env list is lowercase)', async () => {
    const { db, calls } = stubDeps({ email: 'Op@OneTribe.World' })
    const handler = createAccountDeleteHandler({ db, adminEmails: ['op@onetribe.world'] })
    const res = await handler(deleteRequest('valid'))
    expect(res.status).toBe(403)
    expect(calls.deleted).toBe(0)
  })

  test('a regular email account still deletes (anonymize then deleteUser)', async () => {
    const { db, calls } = stubDeps({ email: 'fan@example.com' })
    const handler = createAccountDeleteHandler({ db, adminEmails: ['op@onetribe.world'] })
    const res = await handler(deleteRequest('valid'))
    expect(res.status).toBe(200)
    expect(calls).toEqual({ anonymized: 1, deleted: 1 })
  })

  test('an anonymous passport (no email) is never blocked by the guard', async () => {
    const { db, calls } = stubDeps({ email: undefined })
    const handler = createAccountDeleteHandler({ db, adminEmails: ['op@onetribe.world'] })
    const res = await handler(deleteRequest('valid'))
    expect(res.status).toBe(200)
    expect(calls.deleted).toBe(1)
  })

  test('no token still 401s before any guard logic', async () => {
    const { db, calls } = stubDeps({ email: 'op@onetribe.world' })
    const handler = createAccountDeleteHandler({ db, adminEmails: ['op@onetribe.world'] })
    const res = await handler(deleteRequest())
    expect(res.status).toBe(401)
    expect(calls).toEqual({ anonymized: 0, deleted: 0 })
  })
})
