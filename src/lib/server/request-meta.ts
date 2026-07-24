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

/**
 * Edge-set geo country from request headers — a 2-letter upper-case code, or
 * null. Powers the IP fallback for a memory's origin country and pre-fills the
 * upload picker (docs/00 D31). Never trusted for auth. Shape check only;
 * membership in the ISO set is enforced where it matters (normalizeCountry).
 * Accepts any header bag with `.get()` — a Request's headers or Next's
 * `headers()` in a server component.
 */
export function countryFromHeaders(headers: { get(name: string): string | null }): string | null {
  const country = headers.get('x-vercel-ip-country') ?? headers.get('cf-ipcountry')
  if (country && /^[A-Za-z]{2}$/.test(country) && country.toUpperCase() !== 'XX') {
    return country.toUpperCase()
  }
  return null
}

/** Request country for the "M countries" counter (D9 P9). Never trusted for auth. */
export function originCountry(req: Request): string | null {
  return countryFromHeaders(req.headers)
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
