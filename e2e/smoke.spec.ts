import { expect, test } from '@playwright/test'

// Placeholder smoke test — replaced by real journeys from W2 on (docs/17 T2.4).
test('home page renders', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('body')).toBeVisible()
})
