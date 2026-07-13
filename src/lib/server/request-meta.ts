import { createHash } from 'node:crypto'

/**
 * Client IP for rate limiting and the reporter fingerprint. Platform-set
 * single-value headers come first — a client can prepend entries to
 * x-forwarded-for when an upstream proxy appends rather than overwrites, so
 * trusting its first hop would let an attacker forge reporter_hint and trip
 * the auto-hide threshold. cf-connecting-ip / x-real-ip are set by the edge,
 * not the client.
 */
export function clientIp(req: Request): string | null {
  const trusted = req.headers.get('cf-connecting-ip') ?? req.headers.get('x-real-ip')
  if (trusted) return trusted
  const forwarded = req.headers.get('x-forwarded-for')
  const first = forwarded?.split(',')[0]?.trim()
  return first || null
}

/** Request country for the "M countries" counter (D9 P9). Never trusted for auth. */
export function originCountry(req: Request): string | null {
  const country = req.headers.get('x-vercel-ip-country') ?? req.headers.get('cf-ipcountry')
  if (country && /^[A-Za-z]{2}$/.test(country) && country.toUpperCase() !== 'XX') {
    return country.toUpperCase()
  }
  return null
}

/**
 * Pseudonymized IP fingerprint — rate limiting and reporter_hint. The raw
 * IP is never stored (docs/05 GDPR posture). `scope` namespaces counters
 * so upload and report limits don't share a bucket.
 */
export function hashIp(ip: string | null, scope: string): string {
  return createHash('sha256')
    .update(`${scope}:${ip ?? 'unknown'}`)
    .digest('hex')
}
