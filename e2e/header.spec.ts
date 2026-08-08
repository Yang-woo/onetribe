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
 * Room left in the bar: its content box minus everything in it, gaps included.
 * Negative means the row no longer fits.
 *
 * Not the gap between the groups — nothing in this header shrinks
 * (`whitespace-nowrap` throughout, no `min-w-0`), so an over-long row overflows
 * the bar instead of squeezing the gap, and the gap reads its full `gap-*`
 * value at the moment of worst failure. A floor on the gap cannot fail.
 *
 * Every child, not the two we know about: a fifth control added to the bar has
 * to enter this sum, or it would overflow the row while this still reported
 * room. And the gaps have to come off, or "greater than zero" means "fits with
 * exactly nothing to spare" — which is the state this whole spec exists to
 * catch.
 */
const freeSpace = (page: Page) =>
  page.evaluate(() => {
    const bar = document.querySelector('header > div') as HTMLElement
    const children = [...bar.children] as HTMLElement[]
    const style = getComputedStyle(bar)
    const content = bar.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
    const used = children.reduce((total, el) => total + el.getBoundingClientRect().width, 0)
    const gaps = parseFloat(style.columnGap) * Math.max(0, children.length - 1)
    return Math.round(content - used - gaps)
  })

test('the header fits every phone width in every language', async ({ page }, testInfo) => {
  // One project is enough for the sweep: every case sets its own viewport,
  // which overrides the device emulation, so both projects measure the same
  // numbers — and this is 17 page loads.
  test.skip(
    testInfo.project.name !== 'mobile-chromium',
    'viewport is set per case; the other project would assert identical widths',
  )
  // 17 loads of a force-dynamic, DB-backed route. The default 30s is close
  // enough that a cold runner would report this guard as a timeout.
  test.setTimeout(120_000)

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
      //
      // 8px is about twice the drift measured between this repo's macOS and
      // Linux CI runs. Anything tighter fits on the machine it was tuned on
      // and overflows on the other, which is exactly how this shipped twice.
      expect(
        await freeSpace(page),
        `${locale} has too little room left at ${width}px`,
      ).toBeGreaterThanOrEqual(8)
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

  // The mark carries `aria-hidden`, so the wordmark is the home link's only
  // name. Hiding it with `display:none` to reclaim its width left the link
  // nameless on every phone; `sr-only` keeps the name and costs no width.
  await expect(page.locator('header').getByRole('link', { name: 'ONE TRIBE' })).toBeAttached()
})

test('the wordmark comes back once there is room', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 800 })
  await page.goto('/en')

  // The other half of the responsive lockup. Without this, deleting the
  // `sm:` half ships a bare beam mark at every width and the phone sweep
  // above stays green (docs/00 D8 — no tests written to pass).
  // By width, not `toBeVisible`: `sr-only` leaves a clipped 1×1 box that
  // Playwright still calls visible, so dropping the `sm:` half would slip past
  // a visibility check while shipping a bare beam mark.
  const wordmark = page.locator('header').getByText('ONE TRIBE')
  expect(
    (await wordmark.boundingBox())!.width,
    'the wordmark is still screen-reader-only',
  ).toBeGreaterThan(50)

  // And the full call to action returns with it.
  await expect(page.locator('header').getByRole('link', { name: 'add your moment' })).toHaveText(
    'add your moment',
    { useInnerText: true },
  )
})
