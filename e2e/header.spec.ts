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

/**
 * Room left in the bar: its content box minus the two groups in it. Negative
 * means they have already collided.
 *
 * Not the gap between them — nothing in this header shrinks (`whitespace-nowrap`
 * throughout, no `min-w-0`), so an over-long row overflows the bar instead of
 * squeezing the gap, and the gap reads its full `gap-*` value at the moment of
 * worst failure. A floor on the gap is an assertion that cannot fail.
 */
const freeSpace = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const bar = document.querySelector('header > div') as HTMLElement
    const [mark, group] = [...bar.children] as HTMLElement[]
    const style = getComputedStyle(bar)
    const content = bar.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
    return Math.round(
      content - mark.getBoundingClientRect().width - group.getBoundingClientRect().width,
    )
  })

test('the header fits every phone width without scrolling the page sideways', async ({ page }) => {
  // One load, then resize: the rules under test are media queries, so nothing
  // here is decided at navigation time.
  await page.goto('/en')

  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 800 })

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow, `the page scrolls sideways at ${width}px`).toBe(0)

    // Room to spare, not a bare fit. The select is as wide as its widest option
    // and several are native names (简体中文, 한국어) with no glyphs in our two
    // fonts, so its width comes from whatever font the OS supplies — different
    // on CI, on an iPhone, on Android. Headroom is a requirement here, not a
    // test artifact.
    expect(await freeSpace(page), `the header has no room left at ${width}px`).toBeGreaterThan(0)
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
