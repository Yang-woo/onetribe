import { afterEach, describe, expect, test, vi } from 'vitest'
import { verifyTurnstile } from './turnstile'

/**
 * The bot-gate's environment behavior is security policy (docs/00 D9 P4):
 * fail-closed in production without keys, open only in dev or under the
 * explicit CI bypass flag.
 */

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('verifyTurnstile', () => {
  test('TURNSTILE_BYPASS=1 allows without network (CI/E2E only)', async () => {
    vi.stubEnv('TURNSTILE_BYPASS', '1')
    vi.stubEnv('NODE_ENV', 'production')
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    await expect(verifyTurnstile(null, null)).resolves.toBe(true)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  test('production without a secret fails closed', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('TURNSTILE_SECRET_KEY', '')
    vi.stubEnv('TURNSTILE_BYPASS', '')
    await expect(verifyTurnstile('any-token', null)).resolves.toBe(false)
  })

  test('dev without a secret allows (Phase 2 accounts may not exist yet)', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('TURNSTILE_SECRET_KEY', '')
    vi.stubEnv('TURNSTILE_BYPASS', '')
    await expect(verifyTurnstile(null, null)).resolves.toBe(true)
  })

  test('with a secret, a missing token is rejected before any network call', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'secret')
    vi.stubEnv('TURNSTILE_BYPASS', '')
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    await expect(verifyTurnstile(null, null)).resolves.toBe(false)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  test('with a secret, the token goes to siteverify and its verdict is returned', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'secret')
    vi.stubEnv('TURNSTILE_BYPASS', '')
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request) => {
        expect(String(url)).toContain('challenges.cloudflare.com')
        return Response.json({ success: true })
      }),
    )
    await expect(verifyTurnstile('tok', '1.2.3.4')).resolves.toBe(true)
  })
})
