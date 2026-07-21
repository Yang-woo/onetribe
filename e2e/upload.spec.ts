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
  await expect(page.getByText(/Unofficial fan project/)).toBeVisible()
})

test('locale routes serve translated copy with full hreflang alternates (T3.1)', async ({
  page,
}) => {
  await page.goto('/ko')
  await expect(page.getByText('올해, 그 주말은 끝내 오지 않았다.')).toBeVisible()

  const hreflangs = await page
    .locator('link[rel="alternate"][hreflang]')
    .evaluateAll((links) => links.map((l) => l.getAttribute('hreflang')))
  for (const locale of ['en', 'nl', 'de', 'es', 'fr', 'it', 'pt', 'ja', 'ko', 'x-default']) {
    expect(hreflangs).toContain(locale)
  }
})
