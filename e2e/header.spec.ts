import { expect, test, type Page } from '@playwright/test'
import { LOCALES } from '../src/lib/locales'

/**
 * The header carries four things at once — mark, passport, language, upload —
 * and none of them wraps. Together they needed 436px, so every phone narrower
 * than that scrolled the whole site sideways and clipped the upload button off
 * the right edge. It shipped that way from the logo work (D24) until 2026-08.
 *
 * Every locale, because the budget is really seventeen budgets. The first fix
 * was measured against English and left Portuguese overflowing at every phone
 * width including 390 — the label runs `add your moment` in English and
 * `acrescenta o teu momento` in Portuguese. A sweep that visits one language
 * certifies one language.
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
const freeSpace = (page: Page) =>
  page.evaluate(() => {
    const bar = document.querySelector('header > div') as HTMLElement
    const [mark, group] = [...bar.children] as HTMLElement[]
    const style = getComputedStyle(bar)
    const content = bar.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
    return Math.round(
      content - mark.getBoundingClientRect().width - group.getBoundingClientRect().width,
    )
  })

test('the header fits every phone width in every language', async ({ page }, testInfo) => {
  // One project is enough for the sweep: every case sets its own viewport,
  // which overrides the device emulation, so both projects measure the same
  // numbers — and this is 17 page loads.
  test.skip(
    testInfo.project.name !== 'mobile-chromium',
    'viewport is set per case; the other project would assert identical widths',
  )

  for (const locale of LOCALES) {
    // One load per language, then resize: the rules under test are media
    // queries, so nothing here is decided at navigation time.
    await page.goto(`/${locale}`)

    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 800 })

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      expect(overflow, `${locale} scrolls the page sideways at ${width}px`).toBe(0)

      // Room to spare, not a bare fit. The select is as wide as its widest
      // option and several are native names (简体中文, 한국어) with no glyphs in
      // our two fonts, so its width comes from whatever font the OS supplies —
      // different on CI, on an iPhone, on Android. Headroom is a requirement
      // here, not a test artifact.
      expect(await freeSpace(page), `${locale} has no room left at ${width}px`).toBeGreaterThan(0)
    }
  }
})

test('the phone shows the short label but still answers to the full one', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 })
  await page.goto('/en')

  // Visible: the verb alone. Named: the whole call to action — so a speech-input
  // user saying either reaches it, and the accessible name contains what is on
  // screen (WCAG 2.5.3). messages.test.ts keeps that true for all 17 locales.
  // Scoped to the header — the hero's big orange button carries the same name.
  const cta = page.locator('header').getByRole('link', { name: 'add your moment' })
  await expect(cta).toBeVisible()
  // useInnerText: the full label is still in the DOM, hidden — textContent
  // would read both spans as "addadd your moment".
  await expect(cta).toHaveText('add', { useInnerText: true })

  // Clipping is what the overflow actually cost the user: the button was the
  // last item, so it was the one that fell off the edge.
  const box = (await cta.boundingBox())!
  expect(box.x + box.width, 'the upload button is cut off at the right edge').toBeLessThanOrEqual(
    390,
  )
})
