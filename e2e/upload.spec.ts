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
  // Two copies on this page by design (docs/00 D51) — the footer's, and one
  // under the counters. Counted, not `.first()`: this is the home page's only
  // coverage of the footer disclaimer (policies.spec.ts visits policy routes
  // only), and `.first()` would keep passing if the footer's copy vanished.
  await expect(page.getByText(/Unofficial fan project/)).toHaveCount(2)
  await expect(page.getByText(/Unofficial fan project/).first()).toBeVisible()
})

test('the wall info button reaches the policy links without scrolling (D51)', async ({ page }) => {
  await page.goto('/en')

  const info = page.getByRole('button', { name: 'site info' })
  await expect(info).toBeVisible()
  await expect(info).toHaveAttribute('aria-expanded', 'false')

  // `fixed` puts it bottom-left whatever the source order, so the source order
  // is free to serve the keyboard: ahead of the wall, a reader reaches it right
  // after the hero instead of after every card — which is the whole point.
  const beforeWall = await info.evaluate(
    (el, wall) => !!(el.compareDocumentPosition(wall!) & Node.DOCUMENT_POSITION_FOLLOWING),
    await page.locator('#wall').elementHandle(),
  )
  expect(beforeWall, 'the info button comes after the wall in tab order').toBe(true)

  // Tappability asserted directly, as the property that matters: the button's
  // own centre is the topmost element there. Playwright's click has to scroll
  // and re-hit-test, and on the phone project that dance kept landing on the
  // hero underneath even though the button was on top the whole time.
  const topmostIsButton = await page.evaluate(() => {
    const el = document.querySelector('[aria-label="site info"]')!
    const box = el.getBoundingClientRect()
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
    return !!hit && (hit === el || el.contains(hit))
  })
  expect(topmostIsButton, 'something is layered over the info button').toBe(true)

  // Opened from the keyboard — the path the source order above exists to serve.
  await info.focus()
  await page.keyboard.press('Enter')
  const panel = page.getByRole('navigation', { name: 'site info' })
  await expect(panel.getByRole('link', { name: 'removals' })).toHaveAttribute(
    'href',
    '/en/takedown',
  )
  await page.keyboard.press('Escape')
  await expect(panel).toBeHidden()

  // Never flush to the left edge — that's where iOS starts its back swipe.
  expect((await info.boundingBox())!.x).toBeGreaterThanOrEqual(16)

  // The gutter branch needs a viewport wider than the 72rem wall plus the
  // button — neither project is, so ask for one. This is the case the position
  // was designed for: a big display must not strand the button in black.
  await page.setViewportSize({ width: 1920, height: 1080 })
  await expect.poll(async () => (await info.boundingBox())!.x).toBeGreaterThan(16)
  const wide = (await info.boundingBox())!
  const wallLeft = (await page.locator('#wall').boundingBox())!.x
  expect(wide.x + wide.width).toBeLessThanOrEqual(wallLeft)
  expect(wallLeft - (wide.x + wide.width)).toBeLessThanOrEqual(56)
})

test('the floating button covers no policy text (D51)', async ({ page }) => {
  await page.goto('/en')

  // First paint, before any scrolling: the hero carries the unofficial-project
  // notice (docs/05 wants it at the top), and on a phone the button's fixed
  // 1rem-from-the-left band runs straight through it. The notice is inset on
  // small screens to clear it — this is what proves it.
  // The BOX, not just the glyphs. An inset made of padding leaves the box full
  // width, and that invisible strip lies over the button and eats taps meant
  // for it — which is a click the notice silently steals, not just a cosmetic
  // overlap. Asserting the box covers both.
  const noticeLeft = (await page
    .getByText(/Unofficial fan project/)
    .first()
    .boundingBox())!.x
  const topBox = (await page.getByRole('button', { name: 'site info' }).boundingBox())!
  expect(
    noticeLeft,
    'the unofficial-project notice reaches over the info button',
  ).toBeGreaterThanOrEqual(topBox.x + topBox.width)

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))

  const button = (await page.getByRole('button', { name: 'site info' }).boundingBox())!

  // Measured in the page so every link is included, laid out or not.
  const linkRects = await page.locator('footer a').evaluateAll((els) =>
    els.map((el) => {
      const { x, y, width, height } = el.getBoundingClientRect()
      return { text: el.textContent ?? '', x, y, width, height }
    }),
  )
  expect(linkRects.length).toBeGreaterThan(0)

  // The footer's bottom padding is what buys this. Without it the button lands
  // on the last row of links at full scroll and swallows taps meant for them.
  for (const link of linkRects) {
    const overlaps =
      link.x < button.x + button.width &&
      link.x + link.width > button.x &&
      link.y < button.y + button.height &&
      link.y + link.height > button.y
    expect(overlaps, `footer link "${link.text}" sits under the info button`).toBe(false)
  }
})

test('locale routes serve translated copy with full hreflang alternates (T3.1)', async ({
  page,
}) => {
  await page.goto('/ko')
  await expect(page.getByText('올해, 그 주말은 끝내 오지 않았다.')).toBeVisible()

  const hreflangs = await page
    .locator('link[rel="alternate"][hreflang]')
    .evaluateAll((links) => links.map((l) => l.getAttribute('hreflang')))
  // Full locale set (docs/00 D19/D20) — 17 locales + x-default.
  for (const locale of [
    'en',
    'nl',
    'de',
    'es',
    'fr',
    'it',
    'pt',
    'pl',
    'sv',
    'tr',
    'id',
    'th',
    'vi',
    'zh',
    'zh-Hant',
    'ja',
    'ko',
    'x-default',
  ]) {
    expect(hreflangs).toContain(locale)
  }
})
