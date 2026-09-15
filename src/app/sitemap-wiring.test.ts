import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { GET } from '@/app/sitemap-index.xml/route'
import { generateSitemaps } from '@/app/sitemap'
import { sitemapIndexXml } from '@/lib/seo'
import middleware from '@/middleware'

/**
 * docs/00 D60 — /sitemap.xml is three pieces that only work together: the
 * middleware rewrite, the index route it rewrites to, and the locale files
 * app/sitemap.ts generates. Each piece has its own test; this pins the joins,
 * because any one of them can change alone and every other test stays green
 * while the URL GSC and Bing hold breaks (a dropped route, an index listing
 * files that were never generated, the index served as something other than XML).
 */

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://onetribe.world')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('/sitemap.xml wiring', () => {
  test('the index lists exactly the files generateSitemaps makes — no more, no fewer', async () => {
    const ids = (await generateSitemaps()).map((file) => file.id)
    const listed = [...sitemapIndexXml().matchAll(/<sitemap><loc>([^<]+)<\/loc><\/sitemap>/g)].map(
      (m) => m[1],
    )
    expect(listed).toEqual(ids.map((id) => `https://onetribe.world/sitemap/${id}.xml`))
  })

  test('the rewrite lands on a route that serves that index as XML', async () => {
    const res = middleware(new NextRequest('https://onetribe.world/sitemap.xml'))
    const target = new URL(res.headers.get('x-middleware-rewrite')!).pathname
    expect(existsSync(join(process.cwd(), 'src/app', target, 'route.ts'))).toBe(true)

    const index = GET()
    expect(index.headers.get('content-type')).toMatch(/^application\/xml/)
    expect(await index.text()).toBe(sitemapIndexXml())
  })
})
