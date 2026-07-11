export type TurnstileVerifier = (
  token: string | null | undefined,
  ip: string | null,
) => Promise<boolean>

/**
 * Cloudflare Turnstile siteverify — the bot gate on every write path
 * (docs/00 D9 P4). Fails closed in production when unconfigured; allows
 * local dev without keys so the wall works before Phase 2 accounts exist.
 */
export const verifyTurnstile: TurnstileVerifier = async (token, ip) => {
  // CI/E2E only — production must never set this (fail-closed stays intact).
  if (process.env.TURNSTILE_BYPASS === '1') return true
  const secret = process.env.TURNSTILE_SECRET_KEY
  if (!secret) return process.env.NODE_ENV !== 'production'
  if (!token) return false
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ secret, response: token, remoteip: ip ?? undefined }),
    })
    if (!res.ok) return false
    const data = (await res.json()) as { success?: boolean }
    return data.success === true
  } catch {
    return false
  }
}
