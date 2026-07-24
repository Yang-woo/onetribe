import { describe, expect, test } from 'vitest'
import { countryFromHeaders } from './request-meta'

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
