import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import { eventIdByYear, seedMemory, serviceClient } from './fixtures'

/**
 * The wall modal shows the WHOLE photo — docs/15 §1. The modal is the only
 * place a moment is sized to *fit* rather than to the column width, and that
 * fit is pure CSS: a percentage `max-height` that silently resolves to `none`
 * when an ancestor's height is auto, at which point a portrait photo grows to
 * width ÷ aspect-ratio and the overflow-hidden row crops it to a centred band.
 * jsdom has no layout engine, so a component test cannot see any of this —
 * only a real browser measuring real boxes can.
 *
 * Seeded, not uploaded: the shapes below have to be big enough to overflow the
 * modal, and going through the upload wizard for each would burn the per-IP
 * rate limit that the upload spec needs.
 */

/**
 * A solid rectangle whose intrinsic size is exactly w×h — no bytes to fetch.
 * `tag` only rides along to keep the URI unique, because `media_url` carries a
 * unique index (`memories_media_url_key`) and two fixtures share the 1710×2280
 * shape. `thumb_url` has no such index — the tag there is only for legibility.
 */
const svgDataUri = (w: number, h: number, tag: string) =>
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" data-fixture="${tag}"><rect width="100%" height="100%" fill="#E3241D"/></svg>`,
  )

const SHAPES = [
  // The reported case: a 3:4 phone photo, cropped to its middle third on desktop.
  { key: 'portrait', label: 'a 3:4 phone photo', w: 1710, h: 2280, ratio: 1710 / 2280 },
  // Taller than the modal on a phone too, so this one bites in both projects.
  { key: 'tall', label: 'a 9:19.5 screenshot', w: 1170, h: 2532, ratio: 1170 / 2532 },
  // Uploaded before we started storing dimensions (docs/00 D32): no reserved
  // ratio, so the box comes from the decoded image instead — same trap.
  { key: 'unsized', label: 'an upload with no stored ratio', w: 1710, h: 2280, ratio: null },
]

/**
 * What the viewer actually sees of the open photo, measured against every
 * clipping ancestor (and the viewport):
 *  - `visible` — the fraction of the image's box that survives the clips.
 *  - `fill`    — how much of the space it was given it actually uses, so
 *                "shrink it until it fits" can't pass as a fix.
 */
async function openPhoto(page: Page, caption: string): Promise<{ visible: number; fill: number }> {
  return page.evaluate((label) => {
    // Scoped by accessible name for the same reason the caller's locator is:
    // this must measure OUR modal, not whatever dialog comes first.
    const img = document.querySelector<HTMLImageElement>(
      `[role="dialog"][aria-label="${label}"] img`,
    )
    if (!img) throw new Error('no image in the open modal')
    const box = img.getBoundingClientRect()

    let clip = { top: 0, left: 0, right: window.innerWidth, bottom: window.innerHeight }
    for (let node = img.parentElement; node; node = node.parentElement) {
      const style = getComputedStyle(node)
      if (style.overflowX === 'visible' && style.overflowY === 'visible') continue
      const rect = node.getBoundingClientRect()
      // The *content* box, not the border box: the modal's row is padded, and
      // an image laid out inside that padding can never reach the outer edge —
      // measuring against it would put `fill` permanently out of reach.
      const edge = (side: 'Top' | 'Right' | 'Bottom' | 'Left') =>
        parseFloat(style[`padding${side}`]) + parseFloat(style[`border${side}Width`])
      clip = {
        top: Math.max(clip.top, rect.top + edge('Top')),
        left: Math.max(clip.left, rect.left + edge('Left')),
        right: Math.min(clip.right, rect.right - edge('Right')),
        bottom: Math.min(clip.bottom, rect.bottom - edge('Bottom')),
      }
    }

    const shownW = Math.max(0, Math.min(box.right, clip.right) - Math.max(box.left, clip.left))
    const shownH = Math.max(0, Math.min(box.bottom, clip.bottom) - Math.max(box.top, clip.top))
    return {
      visible: (shownW * shownH) / (box.width * box.height),
      // Letterboxing pins one axis to the box; the other is free.
      fill: Math.max(box.width / (clip.right - clip.left), box.height / (clip.bottom - clip.top)),
    }
  }, caption)
}

// Playwright tears the worker down on a *timeout* without unwinding to a test's
// `finally`, which would strand live fixtures on every local wall from then on.
// So no test here trusts its own cleanup: each one first sweeps what earlier
// runs left behind — but only rows that have aged out, or the sibling project
// running this same spec in parallel would lose its fixtures mid-test.
test.beforeEach(async () => {
  const anHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  await serviceClient()
    .from('memories')
    .delete()
    .like('caption', 'lightbox-e2e-%')
    .lt('created_at', anHourAgo)
})

test('the modal letterboxes a photo instead of cropping it', async ({ page }) => {
  const service = serviceClient()
  // unique per invocation — the mobile and desktop projects run this against
  // one DB in parallel, so a shared caption would match the wrong card
  const run = randomUUID().slice(0, 8)
  const captionFor = (key: string) => `lightbox-e2e-${run}-${key}`
  const eventId = await eventIdByYear(service, 2015)

  const { data: seeded, error } = await service
    .from('memories')
    .insert(
      SHAPES.map((shape) => ({
        event_id: eventId,
        media_kind: 'image',
        media_url: svgDataUri(shape.w, shape.h, `${run}-${shape.key}`),
        caption: captionFor(shape.key),
        aspect_ratio: shape.ratio,
        rights_confirmed: true,
        status: 'live',
      })),
    )
    .select('id')
  // A silent seed failure would leave the assertions below looking for cards
  // that were never written, which reads as a UI bug.
  if (error) throw error

  try {
    await page.goto('/en')

    for (const shape of SHAPES) {
      // Both the card's open button and the modal itself are labelled with the
      // caption (MomentThumb / Lightbox). Naming the dialog also keeps this off
      // Next's dev-overlay, which is a role=dialog in a shadow root that
      // Playwright's selectors happily pierce.
      const caption = captionFor(shape.key)
      await page.getByRole('button', { name: caption }).click()
      const modal = page.getByRole('dialog', { name: caption })
      const photo = modal.locator('img')
      await expect(photo).toHaveAttribute('data-loaded', 'true')
      // `data-loaded` is not a decode gate — SkeletonImage flips it on error
      // too, by design. Without this, a fixture that failed to render would be
      // measured as a cropped photo and blame the modal's CSS (docs/00 D8).
      expect(await photo.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0)

      const { visible, fill } = await openPhoto(page, caption)
      expect(visible, `${shape.label} is cropped in the modal`).toBeGreaterThan(0.99)
      expect(fill, `${shape.label} is shrunk away from the space it has`).toBeGreaterThan(0.95)

      await page.keyboard.press('Escape')
      await expect(modal).toHaveCount(0)
    }
  } finally {
    // `seeded` is non-null past the error check above — no guard needed here.
    await service
      .from('memories')
      .delete()
      .in(
        'id',
        seeded!.map((row) => row.id),
      )
  }
})

test('the shimmer holds the photo’s box while the bytes are still coming', async ({ page }) => {
  const service = serviceClient()
  const run = randomUUID().slice(0, 8)
  const caption = `lightbox-e2e-${run}-slow`
  // A real URL, not a data: URI — the point is to catch the photo mid-flight,
  // and only a network request can be held open.
  //
  // Only the MODAL's photo is held: the wall card reads `thumb_url` and the
  // modal reads `media_url` (momentImageSrc), so the card gets an instant data:
  // URI. That is the real shape of this moment — thumbnail up, full photo still
  // arriving — and it keeps the held request off the wall entirely, so nothing
  // about page load has to depend on how the browser schedules a card image.
  const held = `http://localhost:3000/__lightbox-fixture-${run}.svg`

  const seededId = await seedMemory(service, {
    event_id: await eventIdByYear(service, 2015),
    media_url: held,
    thumb_url: svgDataUri(171, 228, `${run}-slow-thumb`),
    caption,
    aspect_ratio: 1710 / 2280,
  })

  try {
    // Never fulfilled: the modal stays in its loading state for the whole test.
    await page.route(held, () => {})
    await page.goto('/en')
    await page.getByRole('button', { name: caption }).click()

    const modal = page.getByRole('dialog', { name: caption })
    await expect(modal.locator('img')).toHaveAttribute('data-loaded', 'false')

    // An <img> with no bytes yet has no natural size, so it measures 0x0 and
    // takes its wrapper down with it unless the reserved ratio is on the
    // WRAPPER too — and an `absolute inset-0` shimmer over a collapsed wrapper
    // paints nothing. docs/15 is explicit: skeletons, never a blank hole.
    const shimmer = await modal.locator('.animate-pulse').boundingBox()
    expect(shimmer, 'no shimmer while the photo loads').not.toBeNull()
    expect(shimmer!.width, 'the shimmer collapsed to zero width').toBeGreaterThan(50)
    expect(shimmer!.height, 'the shimmer collapsed to zero height').toBeGreaterThan(50)
  } finally {
    await service.from('memories').delete().eq('id', seededId)
  }
})
