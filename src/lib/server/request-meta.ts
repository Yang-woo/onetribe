import { createHash } from 'node:crypto'

/** First hop of x-forwarded-for (Vercel/Cloudflare set it), else x-real-ip. */
export function clientIp(req: Request): string | null {
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim()
    if (first) return first
  }
  return req.headers.get('x-real-ip')
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
export function hashIp(ip: string | null, scope = ''): string {
  return createHash('sha256')
    .update(`${scope}:${ip ?? 'unknown'}`)
    .digest('hex')
}
