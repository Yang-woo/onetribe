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
    // D18 stacks every language on one page: the doc title appears as the page
    // <h1> and again as each language block's <h2>. Pin the page heading.
    await expect(page.getByRole('heading', { level: 1, name: marker })).toBeVisible()
    await expect(page.getByText(/Unofficial fan project/)).toBeVisible()
    // no [BRACKET] placeholder may survive to a live policy page (docs/10)
    await expect(page.locator('main')).not.toContainText(/\[[A-Z_/]+\]/)
  })
}

test('about tells the creator story', async ({ page }) => {
  await page.goto('/en/about')
  await expect(page.getByText(/fan from South Korea/)).toBeVisible()
})

test('the support rail is reachable and its Ko-fi mark actually loads', async ({ page }) => {
  await page.goto('/en/about')
  const support = page.getByRole('link', { name: /buy the server a coffee/ })
  await expect(support).toHaveAttribute('href', /ko-fi\.com/)

  const mark = support.locator('img')
  // Decorative: the accessible name must stay the label alone (WCAG 2.5.3, D35).
  await expect(mark).toHaveAttribute('alt', '')

  // React's SSR renderer preloads any plain-src <img> that is not lazy, which would
  // race this 20px decoration against the page's font preloads. That the mark stays
  // out of <head> rests on one attribute, so pin it here — dropping loading="lazy"
  // leaves typecheck, lint, the build and every other test green.
  await expect(page.locator('link[rel="preload"][href="/kofi-cup.png"]')).toHaveCount(0)

  // A missing file under public/ survives typecheck, lint and the build — only a
  // real decode proves the mark shipped instead of rendering as a broken icon.
  // naturalWidth is the whole signal: it stays 0 both before the fetch and after a
  // failed one, so polling it waits and verifies in one step (`complete` would not —
  // it flips true on a 404 too). Because the mark is lazy it only fetches once it is
  // in view, and the 17-locale page reflows as fonts swap, so re-scroll every poll
  // rather than once up front — otherwise a shift parks it outside the viewport and
  // the timeout reads exactly like the missing file this test exists to catch.
  await expect
    .poll(async () => {
      await mark.scrollIntoViewIfNeeded()
      return mark.evaluate((el) => (el as HTMLImageElement).naturalWidth)
    })
    .toBeGreaterThan(0)
})

test('every locale sees the binding-language notice', async ({ page }) => {
  // D18: the page is identical for every URL locale and carries one English
  // binding notice (the per-locale enNotice banner was retired).
  await page.goto('/ko/terms')
  await expect(page.getByText(/English is the binding version/)).toBeVisible()
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
