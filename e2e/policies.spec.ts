import { expect, test } from '@playwright/test'

/**
 * Policy pages + security headers — docs/17 T4.3/T4.4. The four policy
 * routes and the footer disclaimer are legal guardrails (docs/05): their
 * presence is release-blocking, so it's pinned here.
 */

const POLICY_PAGES = [
  { path: '/en/terms', marker: 'Terms of Service' },
  { path: '/en/privacy', marker: 'Privacy Policy' },
  { path: '/en/takedown', marker: 'Copyright & Removal' },
  { path: '/en/guidelines', marker: 'Community Guidelines' },
]

for (const { path, marker } of POLICY_PAGES) {
  test(`${path} renders with the disclaimer footer`, async ({ page }) => {
    await page.goto(path)
    await expect(page.getByRole('heading', { name: marker })).toBeVisible()
    await expect(page.getByText(/Unofficial fan project/)).toBeVisible()
    // no [BRACKET] placeholder may survive to a live policy page (docs/10)
    await expect(page.locator('main')).not.toContainText(/\[[A-Z_/]+\]/)
  })
}

test('about tells the creator story', async ({ page }) => {
  await page.goto('/en/about')
  await expect(page.getByText(/fan from South Korea/)).toBeVisible()
})

test('non-EN locales see the binding-language notice', async ({ page }) => {
  await page.goto('/ko/terms')
  await expect(page.getByText('영문 원문이 우선 적용됩니다.')).toBeVisible()
})

test('security headers ship on every page (docs/03)', async ({ page }) => {
  const response = await page.goto('/en')
  const headers = response!.headers()
  expect(headers['content-security-policy']).toContain("default-src 'self'")
  expect(headers['content-security-policy']).toContain("frame-ancestors 'none'")
  expect(headers['x-content-type-options']).toBe('nosniff')
  expect(headers['x-frame-options']).toBe('DENY')
  expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin')
  expect(headers['permissions-policy']).toContain('camera=()')
})
