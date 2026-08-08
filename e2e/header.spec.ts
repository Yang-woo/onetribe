import { expect, test } from '@playwright/test'

/**
 * The header carries four things at once — mark, passport, language, upload —
 * and none of them wraps. Together they needed 436px, so every phone narrower
 * than that scrolled the whole site sideways and clipped the upload button off
 * the right edge. It shipped that way from the logo work (D24) until 2026-08.
 *
 * Widths, not classes: what matters is that nothing overflows, and the header
 * is free to reach that however it likes. 320 is the narrowest phone still in
 * use; the rest are the common ones.
 */
const WIDTHS = [320, 360, 375, 390, 412, 430]

test('the header fits every phone width without scrolling the page sideways', async ({ page }) => {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 800 })
    await page.goto('/en')

    const { overflow, headerNeeds } = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      headerNeeds: (document.querySelector('header > div') as HTMLElement).scrollWidth,
    }))

    expect(overflow, `the page scrolls sideways at ${width}px`).toBe(0)
    expect(headerNeeds, `the header overflows its own bar at ${width}px`).toBeLessThanOrEqual(width)
  }
})

test('the upload call to action stays whole on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 })
  await page.goto('/en')

  // Clipping is what the overflow actually cost the user: the button was the
  // last item, so it was the one that fell off the edge.
  const cta = page.locator('header a[href="/en/upload"]')
  const box = (await cta.boundingBox())!
  expect(box.x + box.width, 'the upload button is cut off at the right edge').toBeLessThanOrEqual(
    390,
  )
  await expect(cta).toBeVisible()
})
