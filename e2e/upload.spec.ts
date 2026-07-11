import { expect, test } from '@playwright/test'

/**
 * Upload happy path — docs/17 T2.4. Runs against the local storage driver
 * (STORAGE_DRIVER=local) and the local Supabase stack: pick a GIF →
 * edition → rights → submit → delete-link screen → the moment is on the
 * wall. Plus the legal gate: no rights checkbox, no submit.
 */

// A 1x1 transparent GIF — GIFs skip canvas compression, so this exercises
// the full pipeline byte-for-byte.
const TINY_GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')

test('uploading a moment publishes it to the wall instantly', async ({ page }, testInfo) => {
  const caption = `e2e-${testInfo.project.name}-${Date.now()}`

  await page.goto('/upload')
  await page.getByLabel('photos').setInputFiles({
    name: 'moment.gif',
    mimeType: 'image/gif',
    buffer: TINY_GIF,
  })
  await page.getByRole('button', { name: 'next', exact: true }).click()

  await page.getByLabel('edition').selectOption({ index: 2 })
  await page.getByLabel(/say something/).fill(caption)
  await page.getByRole('button', { name: 'next', exact: true }).click()

  // legal gate: submit stays disabled until rights are confirmed
  const submit = page.getByRole('button', { name: 'share my moment' })
  await expect(submit).toBeDisabled()
  await page.getByRole('checkbox').check()
  await expect(submit).toBeEnabled()
  await submit.click()

  // instant publish confirmation with the private delete link
  await expect(page.getByText(/it’s live/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'copy delete link' })).toBeVisible()

  // and the wall already shows it
  await page.getByRole('link', { name: 'see it on the wall' }).click()
  await expect(page.getByText(caption).first()).toBeVisible()
})

test('the wall renders with hero, counter and disclaimer', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('the weekend never happened.')).toBeVisible()
  await expect(page.getByText(/moments? · \d+ (country|countries)/)).toBeVisible()
  await expect(page.getByText(/Unofficial fan project/)).toBeVisible()
})
