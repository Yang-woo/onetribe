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
  // Two copies on this page by design (docs/00 D51): the footer's, and one
  // under the counters because the wall auto-loads and the footer's sits below
  // a bottom that keeps moving. `.first()` is the hero one, above the fold.
  await expect(page.getByText(/Unofficial fan project/).first()).toBeVisible()
})

test('the wall info button reaches the policy links without scrolling (D51)', async ({ page }) => {
  await page.goto('/en')

  const info = page.getByRole('button', { name: 'site info' })
  await expect(info).toBeVisible()
  await expect(info).toHaveAttribute('aria-expanded', 'false')

  await info.click()
  const panel = page.getByRole('navigation', { name: 'site info' })
  await expect(panel.getByRole('link', { name: 'removals' })).toHaveAttribute(
    'href',
    '/en/takedown',
  )

  // Never flush to the left edge — that's where iOS starts its back swipe.
  const box = (await info.boundingBox())!
  const wallLeft = (await page.locator('#wall').boundingBox())!.x
  expect(box.x).toBeGreaterThanOrEqual(16)
  if (wallLeft >= box.width + 16) {
    // Wide enough for a gutter: the button parks beside the wall, not on it.
    expect(box.x + box.width).toBeLessThanOrEqual(wallLeft)
  } else {
    // A phone has no gutter to use, so it falls back to the 1rem inset and
    // accepts covering a corner of the bottom-left photo.
    expect(box.x).toBe(16)
  }

  // The gutter branch needs a viewport wider than the 72rem wall plus the
  // button — neither project is, so ask for one. This is the case the position
  // was designed for: a big display must not strand the button in black.
  await page.setViewportSize({ width: 1920, height: 1080 })
  const wide = (await info.boundingBox())!
  const wideWallLeft = (await page.locator('#wall').boundingBox())!.x
  expect(wide.x + wide.width).toBeLessThanOrEqual(wideWallLeft)
  // Anchored to the wall, not the viewport corner: the gap to the photos is
  // the same 3.5rem it would be at any width.
  expect(wideWallLeft - (wide.x + wide.width)).toBeLessThanOrEqual(56)

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
