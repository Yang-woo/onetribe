import { expect, test } from '@playwright/test'

/**
 * The wall's edition filter — docs/00 D12 (cached shell + streaming) and D13
 * (client filtering).
 *
 * The point of client filtering is that a chip click stops costing a server
 * round-trip, *without* giving up the server-rendered deep link. Component
 * tests can't see either half: only a real browser against a real server shows
 * whether `?e=` is applied on the server and whether the click stays local.
 *
 * The canceled 2026 edition is the probe — its filter header renders from seed
 * data alone (docs/11), so these hold on an empty wall and don't need uploads.
 */

const GATHERING_SUB = /The Gathering happened/

test('a deep link arrives already filtered by the server', async ({ page }) => {
  await page.goto('/en?e=2026')
  await expect(page.getByRole('heading', { name: /Sacred Oath/ })).toBeVisible()
  await expect(page.getByText(GATHERING_SUB)).toBeVisible()
  await expect(page.getByRole('link', { name: /2026/ })).toHaveAttribute('aria-current', 'page')
})

test('the deep-linked wall is in the server HTML, not assembled by the browser', async ({
  request,
}) => {
  // No JS runs here at all — this is what a crawler is handed (docs/00 D13 ①).
  const html = await (await request.get('/en?e=2026')).text()
  expect(html).toContain('<h2')
  // the filter header the server rendered, not the chip's label
  expect(html).toMatch(/The Gathering happened/)
  // chips stay real links so they are crawlable (docs/00 D13 ③)
  expect(html).toContain('href="/en?e=2025"')
})

test('the unfiltered wall carries no edition header', async ({ page }) => {
  await page.goto('/en')
  await expect(page.getByText(GATHERING_SUB)).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'all', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  )
})

test('a chip click filters in the browser — no request to the app server', async ({ page }) => {
  await page.goto('/en')
  await page.waitForLoadState('networkidle')

  // The two things C exists to kill. Media and static assets don't count —
  // new cards mean new images either way, and in production those come from R2.
  const roundTrips: string[] = []
  page.on('request', (r) => {
    const url = r.url()
    if (!url.startsWith('http://localhost:3000')) return
    // In production Next prefetches in-viewport footer <Link>s (RSC requests to
    // /en/about, /en/guidelines, …) — filtering to 2026 shortens the wall and
    // pulls the footer into view. Those aren't the wall navigation D13 kills;
    // only a full document load or an RSC re-render of the wall route counts.
    const path = new URL(url).pathname
    if (r.resourceType() === 'document') roundTrips.push(`document ${url}`)
    else if (url.includes('_rsc=') && path === '/en') roundTrips.push(`rsc ${url}`)
  })

  await page.getByRole('link', { name: /2026/ }).click()

  await expect(page.getByText(GATHERING_SUB)).toBeVisible()
  await expect(page).toHaveURL(/\?e=2026$/) // shareable, via pushState
  expect(roundTrips).toEqual([]) // the whole point of docs/00 D13
})

test('back leaves the filter without reloading the page', async ({ page }) => {
  await page.goto('/en')
  await page.waitForLoadState('networkidle')
  // a marker that would not survive a document reload
  await page.evaluate(() => ((window as unknown as { __kept: boolean }).__kept = true))

  await page.getByRole('link', { name: /2026/ }).click()
  await expect(page.getByText(GATHERING_SUB)).toBeVisible()

  await page.goBack()

  await expect(page.getByText(GATHERING_SUB)).toHaveCount(0)
  await expect(page).toHaveURL(/\/en$/)
  expect(await page.evaluate(() => (window as unknown as { __kept?: boolean }).__kept)).toBe(true)
})
