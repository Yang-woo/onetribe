import type { SupabaseClient } from '@supabase/supabase-js'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { createSupabasePassportBackend, passportAuthErrorCode } from './backend'

/**
 * GoTrue error-code → UI bucket mapping (D16). The buckets drive which
 * i18n message the passport forms show, so every code the flows can
 * produce must land somewhere sensible.
 */
describe('passportAuthErrorCode', () => {
  test.each([
    ['email_exists', 'emailInUse'],
    ['otp_disabled', 'noPassport'], // shouldCreateUser:false + unknown email
    ['otp_expired', 'badCode'],
    ['over_email_send_rate_limit', 'rateLimited'],
    ['over_request_rate_limit', 'rateLimited'],
  ] as const)('%s → %s', (code, expected) => {
    expect(passportAuthErrorCode({ code })).toBe(expected)
  })

  test('anything unrecognized falls back to the generic message', () => {
    expect(passportAuthErrorCode({ code: 'brand_new_code' })).toBe('genericError')
    expect(passportAuthErrorCode(new Error('network down'))).toBe('genericError')
    expect(passportAuthErrorCode(null)).toBe('genericError')
    expect(passportAuthErrorCode('nope')).toBe('genericError')
  })
})

/**
 * signInEmailVerify's merge choreography (docs/00 D44). The tricky part isn't
 * the SQL — it's that the anonymous session's token must be captured BEFORE
 * verifyOtp swaps it out, and the merge must fire ONLY when a real anonymous
 * passport is being abandoned for a different account. Best-effort: a merge
 * failure must never undo a successful sign-in.
 */
type Session = { access_token: string; user: { id: string; is_anonymous: boolean } } | null

function fakeClient(session: Session, verifiedId: string): SupabaseClient {
  function table() {
    const chain = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      maybeSingle: async () => ({ data: null }),
      then: (resolve: (v: { data: unknown[] }) => void) => resolve({ data: [] }),
    }
    return chain
  }
  // verifyOtp swaps the local session out, exactly like the real client — so
  // getSession returns the target AFTER it runs. This is what makes the test
  // sensitive to WHEN the anon token is captured: capture it after the swap and
  // you'd read the target (not anonymous) and the merge would never fire.
  const targetSession: Session = {
    access_token: 'target-token',
    user: { id: verifiedId, is_anonymous: false },
  }
  let swapped = false
  return {
    auth: {
      getSession: async () => ({ data: { session: swapped ? targetSession : session } }),
      verifyOtp: async () => {
        swapped = true
        return {
          data: {
            user: { id: verifiedId, is_anonymous: false, email: 'raver@example.com' },
            session: { access_token: 'target-token', user: { id: verifiedId } },
          },
          error: null,
        }
      },
    },
    from: table,
  } as unknown as SupabaseClient
}

const anonSession = (token = 'anon-token', id = 'anon-1'): Session => ({
  access_token: token,
  user: { id, is_anonymous: true },
})

describe('signInEmailVerify — anonymous passport merge', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  /** Answers `statuses` in order, repeating the last one. 0 = network failure. */
  function stubFetch(...statuses: number[]) {
    const queue = statuses.length > 0 ? statuses : [200]
    const fetchMock = vi.fn(async () => {
      const status = queue.length > 1 ? (queue.shift() as number) : queue[0]
      if (status === 0) throw new TypeError('Failed to fetch')
      return { ok: status < 400, status }
    })
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  function stubTimeout() {
    const fetchMock = vi.fn(async () => {
      const err = new Error('signal timed out')
      err.name = 'TimeoutError'
      throw err
    })
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  test('folds the anonymous passport in: POSTs both tokens to the merge route', async () => {
    const fetchMock = stubFetch()
    const backend = createSupabasePassportBackend(fakeClient(anonSession(), 'target-1'))

    const state = await backend.signInEmailVerify('raver@example.com', '123456')
    expect(state.userId).toBe('target-1') // state re-read AFTER the merge

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, opts] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/passport/merge')
    expect((opts.headers as Record<string, string>).authorization).toBe('Bearer target-token')
    expect(JSON.parse(opts.body as string)).toEqual({ anonToken: 'anon-token' })
  })

  test('no merge when there was no session (start-screen sign-in)', async () => {
    const fetchMock = stubFetch()
    const backend = createSupabasePassportBackend(fakeClient(null, 'target-1'))
    await backend.signInEmailVerify('raver@example.com', '123456')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('no merge when the prior session was not anonymous', async () => {
    const fetchMock = stubFetch()
    const notAnon: Session = { access_token: 'real', user: { id: 'u', is_anonymous: false } }
    const backend = createSupabasePassportBackend(fakeClient(notAnon, 'target-1'))
    await backend.signInEmailVerify('raver@example.com', '123456')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('no merge when signing back into the SAME passport (id unchanged)', async () => {
    const fetchMock = stubFetch()
    const backend = createSupabasePassportBackend(fakeClient(anonSession('tok', 'same'), 'same'))
    await backend.signInEmailVerify('raver@example.com', '123456')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('a merge failure does not undo the sign-in (best-effort)', async () => {
    stubFetch(500)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const backend = createSupabasePassportBackend(fakeClient(anonSession(), 'target-1'))
    // resolves to the signed-in state anyway — the user is in their account
    const state = await backend.signInEmailVerify('raver@example.com', '123456')
    expect(state.userId).toBe('target-1')
    // ...but it is not silent: this is the last chance to use the anonymous
    // token, so a failure here is permanent and has to leave a trace
    expect(warn).toHaveBeenCalled()
  })

  test('retries once on a transient fault — the anonymous token has no second chance', async () => {
    // by now verifyOtp has replaced the stored session, so the token exists
    // nowhere but that stack frame. A blip must not be the end of it.
    const fetchMock = stubFetch(500, 200)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const backend = createSupabasePassportBackend(fakeClient(anonSession(), 'target-1'))
    await backend.signInEmailVerify('raver@example.com', '123456')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(warn).not.toHaveBeenCalled()
  })

  test('retries a network failure too', async () => {
    const fetchMock = stubFetch(0, 200)
    const backend = createSupabasePassportBackend(fakeClient(anonSession(), 'target-1'))
    await backend.signInEmailVerify('raver@example.com', '123456')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  test('does NOT retry a refusal — 4xx is a verdict on these two tokens', async () => {
    const fetchMock = stubFetch(403)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const backend = createSupabasePassportBackend(fakeClient(anonSession(), 'target-1'))
    await backend.signInEmailVerify('raver@example.com', '123456')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('gives up after a timeout instead of making sign-in wait twice', async () => {
    // the request is capped so a stalled route can't pin the user on a dead
    // confirm button; spending that budget a second time defeats the cap
    const fetchMock = stubTimeout()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const backend = createSupabasePassportBackend(fakeClient(anonSession(), 'target-1'))
    const state = await backend.signInEmailVerify('raver@example.com', '123456')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(state.userId).toBe('target-1')
  })

  test('caps the request — an open-ended merge would hold the sign-in forever', async () => {
    const fetchMock = stubFetch(200)
    const backend = createSupabasePassportBackend(fakeClient(anonSession(), 'target-1'))
    await backend.signInEmailVerify('raver@example.com', '123456')
    const [, opts] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(opts.signal).toBeInstanceOf(AbortSignal)
  })
})
