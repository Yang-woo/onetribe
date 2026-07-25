import { describe, expect, test } from 'vitest'
import { clientIp, countryFromHeaders } from './request-meta'

/**
 * Geo country resolution (docs/00 D9 P9, D31) — the IP fallback for a memory's
 * origin country and the upload picker's first guess. Shape check only; ISO
 * membership is enforced separately (normalizeCountry).
 */
describe('countryFromHeaders', () => {
  const bag = (h: Record<string, string>) => new Headers(h)

  test('reads the Vercel and Cloudflare geo headers, upper-cased', () => {
    expect(countryFromHeaders(bag({ 'x-vercel-ip-country': 'nl' }))).toBe('NL')
    expect(countryFromHeaders(bag({ 'cf-ipcountry': 'KR' }))).toBe('KR')
  })

  test('prefers the Vercel header when both are present', () => {
    expect(countryFromHeaders(bag({ 'x-vercel-ip-country': 'DE', 'cf-ipcountry': 'FR' }))).toBe(
      'DE',
    )
  })

  test('rejects the "unknown" sentinel and malformed values', () => {
    expect(countryFromHeaders(bag({ 'x-vercel-ip-country': 'XX' }))).toBeNull()
    expect(countryFromHeaders(bag({ 'x-vercel-ip-country': 'USA' }))).toBeNull()
    expect(countryFromHeaders(bag({ 'x-vercel-ip-country': '1' }))).toBeNull()
    expect(countryFromHeaders(bag({}))).toBeNull()
  })
})

/**
 * clientIp is the trust root for rate limiting AND the reporter fingerprint, so
 * a forgeable source is a censorship vector: forged distinct IPs → forged
 * distinct reporter_hints → auto-hide any moment (docs/09 A-2). This app is
 * Vercel-hosted with Cloudflare DNS-only (docs/00 D22), so `cf-connecting-ip` is
 * client-controllable and MUST NOT be trusted.
 */
describe('clientIp', () => {
  const req = (h: Record<string, string>) =>
    new Request('http://localhost/', { headers: new Headers(h) })

  test('uses the Vercel edge header, which the client cannot overwrite', () => {
    expect(clientIp(req({ 'x-vercel-forwarded-for': '203.0.113.7' }))).toBe('203.0.113.7')
  })

  test('IGNORES cf-connecting-ip — CF is not in the request path (grey cloud), so it is forgeable', () => {
    // The exact exploit: an attacker sets only cf-connecting-ip to a fake IP.
    // It must NOT become the client IP (else 3 forged values auto-hide a moment).
    expect(clientIp(req({ 'cf-connecting-ip': '1.1.1.1' }))).toBeNull()
  })

  test('a forged cf-connecting-ip cannot override the real Vercel header', () => {
    const ip = clientIp(
      req({ 'x-vercel-forwarded-for': '203.0.113.7', 'cf-connecting-ip': '1.1.1.1' }),
    )
    expect(ip).toBe('203.0.113.7')
  })

  test('takes only the first hop of the platform header', () => {
    expect(clientIp(req({ 'x-vercel-forwarded-for': '203.0.113.7, 70.0.0.1' }))).toBe('203.0.113.7')
  })

  test('falls back to x-forwarded-for only for local/dev (no Vercel edge)', () => {
    expect(clientIp(req({ 'x-forwarded-for': '10.0.0.9' }))).toBe('10.0.0.9')
  })

  test('returns null when no address header is present', () => {
    expect(clientIp(req({}))).toBeNull()
  })
})
