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

    const { overflow, slack } = await page.evaluate(() => {
      const bar = document.querySelector('header > div') as HTMLElement
      const [mark, group] = [...bar.children] as HTMLElement[]
      return {
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        // Gap between the mark and the right-hand group: the room left before
        // the two collide. `scrollWidth` cannot show this — it only grows once
        // the overflow has already happened.
        slack: group.getBoundingClientRect().left - mark.getBoundingClientRect().right,
      }
    })

    expect(overflow, `the page scrolls sideways at ${width}px`).toBe(0)
    // A few px of margin, not zero: the same markup measures wider under CI's
    // Linux fonts than on macOS, and a header that fits exactly on one machine
    // is a header that overflows on the other.
    expect(slack, `the header has no room left at ${width}px`).toBeGreaterThanOrEqual(4)
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
