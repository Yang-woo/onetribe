import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { NextRequest } from 'next/server'
import middleware from './middleware'

/**
 * Crawl files (/sitemap.xml, /robots.txt) must get the canonical-host 308 like
 * every other page (docs/00 D23), but must NOT be run through i18n routing —
 * they're locale-agnostic. This pins both halves so the matcher/handler can't
 * drift and start locale-redirecting the crawl files (breaks GSC/Bing).
 */
describe('middleware', () => {
  beforeEach(() => {
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://onetribe.world')
  })
  afterEach(() => vi.unstubAllEnvs())

  test('crawl files on the canonical host pass through — no redirect', () => {
    // /llms.txt joined them when it moved out of public/ into a route: the
    // matcher's dotted-path exclusion skips it, so it has to be named twice —
    // once in the matcher, once here — or the locale router swallows it.
    for (const path of ['/sitemap/ko.xml', '/robots.txt', '/llms.txt']) {
      const res = middleware(new NextRequest(`https://onetribe.world${path}`))
      // passed through — not redirected and not rewritten. A rewrite carries no
      // Location either, so that check alone can't tell the two apart (D60).
      expect(res.headers.get('location')).toBeNull()
      expect(res.headers.get('x-middleware-rewrite')).toBeNull()
      expect(res.headers.get('x-middleware-next')).toBe('1')
    }
  })

  test('/sitemap.xml is rewritten to the index route — not redirected, not localized (D60)', () => {
    const res = middleware(new NextRequest('https://onetribe.world/sitemap.xml'))
    // a redirect would move the URL GSC and Bing hold; a rewrite keeps it
    expect(res.headers.get('location')).toBeNull()
    expect(res.headers.get('x-middleware-rewrite')).toBe('https://onetribe.world/sitemap-index.xml')
  })

  test('a non-canonical host 308s crawl files to the canonical host', () => {
    const res = middleware(new NextRequest('https://www.onetribe.world/sitemap.xml'))
    expect(res.status).toBe(308)
    expect(res.headers.get('location')).toBe('https://onetribe.world/sitemap.xml')

    // the per-locale files too (D60) — a www submission must land on the canonical host
    const locale = middleware(new NextRequest('https://www.onetribe.world/sitemap/ko.xml'))
    expect(locale.status).toBe(308)
    expect(locale.headers.get('location')).toBe('https://onetribe.world/sitemap/ko.xml')

    const llms = middleware(new NextRequest('https://www.onetribe.world/llms.txt'))
    expect(llms.status).toBe(308)
    expect(llms.headers.get('location')).toBe('https://onetribe.world/llms.txt')
  })
})
