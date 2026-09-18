import { expect, test } from '@playwright/test'

/**
 * The crawl-file chain on a real server (docs/00 D60): robots.txt names
 * /sitemap.xml, the middleware rewrites it to the index route, and every file
 * the index lists must answer. Unit tests can't see the middleware matcher —
 * drop '/sitemap.xml' from it and the rewrite never runs, which only shows up
 * here as a 404 on the URL GSC and Bing hold.
 */
test('robots → sitemap index → every locale file answers, and unknown files 404', async ({
  request,
}) => {
  const robots = await (await request.get('/robots.txt')).text()
  const indexUrl = robots.match(/^Sitemap: (.+)$/m)?.[1]
  expect(indexUrl, 'robots.txt names no sitemap').toMatch(/\/sitemap\.xml$/)

  // paths only — the host in the XML is whatever NEXT_PUBLIC_SITE_URL the
  // build had, and the chain is what's under test here
  const index = await request.get(new URL(indexUrl!).pathname)
  expect(index.status()).toBe(200)
  expect(index.headers()['content-type']).toMatch(/^application\/xml/)
  const files = [...(await index.text()).matchAll(/<sitemap><loc>([^<]+)<\/loc><\/sitemap>/g)].map(
    (m) => new URL(m[1]).pathname,
  )
  // one per supported locale (17 since D20)
  expect(files).toHaveLength(17)
  expect(files).toContain('/sitemap/ko.xml')

  for (const file of files) {
    const res = await request.get(file)
    expect(res.status(), file).toBe(200)
    expect(await res.text(), file).toContain('<urlset')
  }

  expect((await request.get('/sitemap/xx.xml')).status()).toBe(404)
})

/**
 * /llms.txt moved out of public/ into a route so it can carry live figures
 * (GEO). Only a real server shows whether the middleware lets it through:
 * drop it from the matcher and the locale router swallows it, which unit
 * tests cannot see — the same blind spot D60 found for the sitemap.
 */
test('llms.txt is served as plain text and names the project', async ({ request }) => {
  const res = await request.get('/llms.txt')
  expect(res.status()).toBe(200)
  expect(res.headers()['content-type']).toMatch(/^text\/plain/)
  const body = await res.text()
  expect(body).toContain('# one tribe')
  // the unaffiliated notice travels with the description, never optional
  expect(body).toContain('Not affiliated')

  // The live figures are the whole reason this stopped being a file in
  // public/. Without these two assertions the route could answer with the
  // figure-less fallback forever and this test would not notice.
  expect(body, 'llms.txt carries no live figures').toMatch(/- Moments on the wall: \d+/)
  const asOf = body.match(/- As of: (\S+)/)?.[1]
  expect(asOf, 'figures with no as-of stamp are not quotable').toBeTruthy()
  const stamped = new Date(asOf!)
  expect(Number.isNaN(stamped.getTime()), `unparseable as-of: ${asOf}`).toBe(false)
  // in the past, but no tighter: the route is revalidated hourly, so an hour
  // of staleness is the designed behavior, not a failure
  expect(stamped.getTime()).toBeLessThanOrEqual(Date.now())
})
