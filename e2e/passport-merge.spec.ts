import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { otpFor } from '../tests/mailpit'

/**
 * Anonymous passport merge on sign-in — docs/00 D44. A device that already
 * holds an anonymous passport (with its own stamp AND its own upload) signs
 * into a DIFFERENT existing account; both must fold into that account instead
 * of being orphaned. This is the whole point of D44 — an upload/stamp made from
 * a fresh browser isn't lost when the user signs into the passport they already
 * have. The moment matters most: a stamp can be re-clicked, a photo can't.
 */

// A 1x1 transparent GIF — GIFs skip canvas compression, so the upload runs the
// full pipeline byte-for-byte (same fixture as upload.spec.ts).
const TINY_GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')

test('an anonymous stamp and moment fold into the account signed into', async ({ page }) => {
  const email = `e2e-merge-${randomUUID().slice(0, 8)}@test.onetribe`

  // ── set up account A: an anonymous passport, stamp 2019, link the email ──
  await page.goto('/en/passport')
  await page.getByLabel('your name on the wall').fill('account owner')
  await page.getByRole('button', { name: 'create my passport' }).click()
  await expect(page.getByText('my journey')).toBeVisible()
  await page.getByRole('button', { name: '2019', exact: true }).click()
  await expect(page.getByRole('button', { name: '2019', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.getByRole('button', { name: 'connect an email' }).click()
  await page.getByLabel('your email').fill(email)
  await page.getByRole('button', { name: 'send me a code' }).click()
  const linkCode = await otpFor(email)
  await page.getByLabel('6-digit code').fill(linkCode)
  await page.getByRole('button', { name: 'confirm' }).click()
  await expect(page.getByText(`connected as ${email}`)).toBeVisible()

  // sign out → back to the start screen (account A now lives only under the email)
  await page.getByRole('button', { name: 'sign out on this device' }).click()
  await expect(page.getByText('start anonymously — just pick a name')).toBeVisible()

  // ── fresh anonymous passport B on this device, with a DIFFERENT stamp (2022) ──
  await page.getByLabel('your name on the wall').fill('this device')
  await page.getByRole('button', { name: 'create my passport' }).click()
  await expect(page.getByText('my journey')).toBeVisible()
  await page.getByRole('button', { name: '2022', exact: true }).click()
  await expect(page.getByRole('button', { name: '2022', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )

  // ── B uploads a moment: the thing that can't be re-made if the merge drops it ──
  const caption = `e2e-merge-${randomUUID().slice(0, 8)}`
  await page.goto('/upload')
  await page.getByLabel('photos').setInputFiles({
    name: 'moment.gif',
    mimeType: 'image/gif',
    buffer: TINY_GIF,
  })
  await page.getByRole('radio').nth(2).click() // an edition chip
  await page.getByLabel(/say something/).fill(caption)
  await page.getByRole('button', { name: 'next', exact: true }).click()
  await page.getByRole('checkbox').check({ force: true })
  await page.getByRole('button', { name: 'share my moment' }).click()
  await expect(page.getByRole('heading', { name: /on the wall/ })).toBeVisible()

  // it belongs to B right now — this is what the merge has to move
  await page.goto('/en/passport')
  await expect(page.getByRole('button', { name: caption })).toBeVisible()

  // ── sign into the existing account A from B → merge (no stay-behind confirm) ──
  await page.getByRole('button', { name: 'i already have a passport' }).click()
  await page.getByLabel('your email').fill(email)
  await page.getByRole('button', { name: 'send me a code' }).click()
  const signInCode = await otpFor(email, linkCode)
  await page.getByLabel('6-digit code').fill(signInCode)
  await page.getByRole('button', { name: 'confirm' }).click()

  // we're in account A (its name), connected as the email
  await expect(page.getByText('my journey')).toBeVisible()
  await expect(page.getByText('account owner')).toBeVisible()
  await expect(page.getByText(`connected as ${email}`)).toBeVisible()
  // A's own stamp survived AND B's stamp was carried in by the merge
  await expect(page.getByRole('button', { name: '2019', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(page.getByRole('button', { name: '2022', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  // ...and B's moment is now in A's passport — reassigned server-side, re-read
  // after the merge, and visible to A's own session under RLS
  await expect(page.getByRole('button', { name: caption })).toBeVisible()
})
