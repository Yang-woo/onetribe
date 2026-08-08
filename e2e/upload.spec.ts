import { expect, test } from '@playwright/test'

/**
 * Upload happy path — docs/17 T2.4 (redesign 2026-07-16 §3: 2 steps). Runs
 * against the local storage driver (STORAGE_DRIVER=local) and the local
 * Supabase stack: pick a GIF → edition chip → caption → sign → rights →
 * submit → delete-link screen → the moment is on the wall. Plus the legal
 * gate: no rights checkbox, no submit.
 */

// A 1x1 transparent GIF — GIFs skip canvas compression, so this exercises
// the full pipeline byte-for-byte.
const TINY_GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')

test('uploading a moment publishes it to the wall instantly', async ({ page }, testInfo) => {
  const caption = `e2e-${testInfo.project.name}-${Date.now()}`

  await page.goto('/upload')
  // step 1: media + edition + caption (photos is the default mode)
  await page.getByLabel('photos').setInputFiles({
    name: 'moment.gif',
    mimeType: 'image/gif',
    buffer: TINY_GIF,
  })
  await page.getByRole('radio').nth(2).click() // pick an edition chip (a recent edition)
  await page.getByLabel(/say something/).fill(caption)
  await page.getByRole('button', { name: 'next', exact: true }).click()

  // step 2: sign & publish — legal gate: submit stays disabled until rights
  const submit = page.getByRole('button', { name: 'share my moment' })
  await expect(submit).toBeDisabled()
  // the rights checkbox is a real input but sr-only (styled as a card, D11);
  // force past Playwright's visibility actionability check.
  await page.getByRole('checkbox').check({ force: true })
  await expect(submit).toBeEnabled()
  await submit.click()

  // instant publish confirmation with the private delete link
  await expect(page.getByRole('heading', { name: /on the wall/ })).toBeVisible()
  await expect(page.getByRole('button', { name: 'copy delete link' })).toBeVisible()

  // and the wall already shows it
  await page.getByRole('link', { name: 'see it on the wall' }).click()
  await expect(page.getByText(caption).first()).toBeVisible()
})

test('the wall renders with hero, counter and disclaimer', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/en$/) // locale negotiation redirect (T3.1)
  await expect(page.getByText('the weekend never happened.')).toBeVisible()
  await expect(page.getByText(/moments? · \d+ (country|countries)/)).toBeVisible()
  // Two copies on this page by design (docs/00 D51) — the footer's, and one
  // under the counters. Counted, not `.first()`: this is the home page's only
  // coverage of the footer disclaimer (policies.spec.ts visits policy routes
  // only), and `.first()` would keep passing if the footer's copy vanished.
  await expect(page.getByText(/Unofficial fan project/)).toHaveCount(2)
  await expect(page.getByText(/Unofficial fan project/).first()).toBeVisible()
})

test('the wall info button reaches the policy links without scrolling (D51)', async ({ page }) => {
  await page.goto('/en')

  const info = page.getByRole('button', { name: 'site info' })
  await expect(info).toBeVisible()
  await expect(info).toHaveAttribute('aria-expanded', 'false')

  // `fixed` puts it bottom-left whatever the source order, so the source order
  // is free to serve the keyboard: ahead of the wall, a reader reaches it right
  // after the hero instead of after every card — which is the whole point.
  const beforeWall = await info.evaluate(
    (el, wall) => !!(el.compareDocumentPosition(wall!) & Node.DOCUMENT_POSITION_FOLLOWING),
    await page.locator('#wall').elementHandle(),
  )
  expect(beforeWall, 'the info button comes after the wall in tab order').toBe(true)

  await info.click()
  const panel = page.getByRole('navigation', { name: 'site info' })
  await expect(panel.getByRole('link', { name: 'removals' })).toHaveAttribute(
    'href',
    '/en/takedown',
  )

  // Both position cases, pinned explicitly rather than branched on whichever
  // project is running — a conditional assertion can pass by taking the branch
  // you weren't testing, and at 1280 the two are separated by a scrollbar's
  // width.
  const leftEdgeOf = async (locator: typeof info) => (await locator.boundingBox())!.x

  // No gutter: the button falls back to the 1rem inset and accepts covering a
  // corner of the bottom-left photo. 1rem, not 0 — the left edge is where iOS
  // starts its back swipe. Polled, because a plain `expect(value)` does not
  // retry and would read the pre-resize box; approximate, because Pixel 7's
  // 2.625 device ratio can hand back 15.99.
  await page.setViewportSize({ width: 390, height: 844 })
  await expect.poll(() => leftEdgeOf(info)).toBeCloseTo(16, 0)

  // Gutter: it parks beside the wall, off the photos entirely, and stays 3.5rem
  // from them however wide the display gets — never stranded in the black.
  await page.setViewportSize({ width: 1920, height: 1080 })
  await expect.poll(() => leftEdgeOf(info)).toBeGreaterThan(16)
  const wide = (await info.boundingBox())!
  const wallLeft = await leftEdgeOf(page.locator('#wall'))
  expect(wide.x + wide.width).toBeLessThanOrEqual(wallLeft)
  expect(wallLeft - (wide.x + wide.width)).toBeLessThanOrEqual(56)

  // Esc gives the page back.
  await page.keyboard.press('Escape')
  await expect(panel).toBeHidden()
})

test('locale routes serve translated copy with full hreflang alternates (T3.1)', async ({
  page,
}) => {
  await page.goto('/ko')
  await expect(page.getByText('올해, 그 주말은 끝내 오지 않았다.')).toBeVisible()

  const hreflangs = await page
    .locator('link[rel="alternate"][hreflang]')
    .evaluateAll((links) => links.map((l) => l.getAttribute('hreflang')))
  // Full locale set (docs/00 D19/D20) — 17 locales + x-default.
  for (const locale of [
    'en',
    'nl',
    'de',
    'es',
    'fr',
    'it',
    'pt',
    'pl',
    'sv',
    'tr',
    'id',
    'th',
    'vi',
    'zh',
    'zh-Hant',
    'ja',
    'ko',
    'x-default',
  ]) {
    expect(hreflangs).toContain(locale)
  }
})
