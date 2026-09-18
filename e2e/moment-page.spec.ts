import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { eventIdByYear, seedMemory, serviceClient } from './fixtures'

/**
 * What a crawler reads (docs/00 D59). The wall's server HTML has to link each
 * card to its moment page — before D59 the card was a button and nothing on
 * the site pointed at /m/[id] — and that page has to name itself with an h1
 * and a meta description even when the uploader wrote no caption, which is
 * most moments (docs/00 D58).
 *
 * The link is read from the raw response, not the hydrated page: the claim is
 * about the HTML a crawler receives. The client render is covered by
 * moment-thumb.test.tsx.
 */

const svgDataUri = (tag: string) =>
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" data-fixture="${tag}"><rect width="100%" height="100%" fill="#FF6A00"/></svg>`,
  )

test('the wall links a caption-less moment to a page that heads and describes it', async ({
  page,
  request,
}) => {
  const service = serviceClient()
  const run = randomUUID().slice(0, 8)
  const name = `seo-e2e-${run}`
  // the 2015 seed row (supabase/migrations/20260712000400_seed_events.sql)
  const line = 'Biddinghuizen · 2015 · Defqon.1 — No Guts No Glory'
  const id = await seedMemory(service, {
    event_id: await eventIdByYear(service, 2015),
    media_url: svgDataUri(run),
    author_name: name,
    origin_country: 'NL',
  })

  try {
    const wall = await request.get('/en')
    expect(wall.ok()).toBe(true)
    expect(await wall.text(), 'the wall HTML links no card to this moment page').toContain(
      `href="/en/m/${id}"`,
    )

    await page.goto(`/en/m/${id}`)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(line)
    // no caption, so every part of this is a fact the page already shows
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      'content',
      `${line} · ${name} · Netherlands`,
    )

    // lib/seo builds the structured data, but nothing read the page's own
    // ld+json — so dropping the edition/city argument here, or the og:url,
    // passed every test (test review, 2026-09-18). Read from the raw HTML:
    // the claim is about what a crawler receives.
    const raw = await (await request.get(`/en/m/${id}`)).text()
    const block = raw.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)
    expect(block, 'the moment page emitted no structured data').not.toBeNull()
    const ld = JSON.parse(block![1])
    expect(ld['@type']).toBe('ImageObject')
    expect(ld.name, 'the edition line never reached the structured data').toBe(line)
    expect(ld.contentLocation).toEqual({ '@type': 'Place', name: 'Biddinghuizen' })
    // upload time, not capture time — an old photo must not be dated to today
    expect(ld.uploadDate).toBeTruthy()
    expect(ld.publisher['@id']).toMatch(/#organization$/)
    expect(ld.isPartOf['@id']).toMatch(/#website$/)

    expect(raw, 'the moment card names no address of its own').toMatch(
      new RegExp(`<meta property="og:url" content="[^"]*/en/m/${id}"`),
    )
  } finally {
    await service.from('memories').delete().eq('id', id)
  }
})
