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
    for (const path of ['/sitemap.xml', '/robots.txt']) {
      const res = middleware(new NextRequest(`https://onetribe.world${path}`))
      // NextResponse.next() carries no Location — it did not i18n-rewrite either.
      expect(res.headers.get('location')).toBeNull()
    }
  })

  test('a non-canonical host 308s crawl files to the canonical host', () => {
    const res = middleware(new NextRequest('https://www.onetribe.world/sitemap.xml'))
    expect(res.status).toBe(308)
    expect(res.headers.get('location')).toBe('https://onetribe.world/sitemap.xml')
  })
})
