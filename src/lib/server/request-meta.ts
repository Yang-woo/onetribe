import { createHash } from 'node:crypto'

/**
 * Client IP for rate limiting and the reporter fingerprint. Trust ONLY a header
 * the platform sets and the client cannot overwrite. This app is Vercel-hosted
 * with Cloudflare as DNS-only (grey cloud, docs/00 D22) — so the CF proxy is NOT
 * in the request path and `cf-connecting-ip` is fully client-controllable. Using
 * it would let an attacker send N reports with N forged IPs, manufacture N
 * distinct reporter_hints, and trip the 3-strike auto-hide on any moment
 * (docs/09 A-2) — a one-box censorship DoS. So it is deliberately NOT read here.
 *
 * `x-vercel-forwarded-for` lives in Vercel's reserved `x-vercel-*` namespace,
 * which the edge always rewrites, so it is unforgeable and present on every
 * production request — it always wins before the fallbacks below are reached.
 * `x-real-ip` / `x-forwarded-for` are only a local/dev fallback (no Vercel edge
 * there); in production the first header always resolves first.
 *
 * If Cloudflare is ever switched to a proxied (orange-cloud) record, re-introduce
 * `cf-connecting-ip` — but only authenticated via a shared CF↔origin secret.
 */
export function clientIp(req: Request): string | null {
  const platform = req.headers.get('x-vercel-forwarded-for') ?? req.headers.get('x-real-ip')
  if (platform) return platform.split(',')[0]?.trim() || null
  const forwarded = req.headers.get('x-forwarded-for')
  const first = forwarded?.split(',')[0]?.trim()
  return first || null
}

/**
 * Edge-set geo country from request headers — a 2-letter upper-case code, or
 * null. Pre-fills the upload country picker only (docs/00 D31; the stored
 * origin_country comes from the picker's explicit value, not an IP fallback).
 * Never trusted for auth. `cf-ipcountry` is kept as a fallback — unlike clientIp,
 * which dropped the grey-cloud CF header: this is display-prefill, not a trust
 * boundary, so forging it only changes the forger's own default, never the
 * stored country or a counter. Shape check only; ISO membership is enforced by
 * normalizeCountry. Accepts any header bag with `.get()` — a Request's headers
 * or Next's `headers()` in a server component.
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
