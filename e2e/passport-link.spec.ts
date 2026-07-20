import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { otpFor } from '../tests/mailpit'

/**
 * Passport upgrade round trip — docs/15 §4, D16. Anonymous start → link an
 * email with a real OTP (Mailpit) → leave the device → sign back in → the
 * same passport (stamps intact) opens. This is the whole point of D16:
 * the passport survives the browser.
 */

test('anonymous passport → email link → sign back in with stamps intact', async ({ page }) => {
  const email = `e2e-link-${randomUUID().slice(0, 8)}@test.onetribe`

  // anonymous start
  await page.goto('/en/passport')
  await page.getByLabel('your name on the wall').fill('e2e warrior')
  await page.getByRole('button', { name: 'create my passport' }).click()
  await expect(page.getByText('my journey')).toBeVisible()

  // stamp an edition so there's something to survive the round trip
  await page.getByRole('button', { name: '2024', exact: true }).click()
  await expect(page.getByRole('button', { name: '2024', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )

  // link the email via a real OTP
  await page.getByRole('button', { name: 'connect an email' }).click()
  await page.getByLabel('your email').fill(email)
  await page.getByRole('button', { name: 'send me a code' }).click()
  const code = await otpFor(email)
  await page.getByLabel('6-digit code').fill(code)
  await page.getByRole('button', { name: 'confirm' }).click()
  await expect(page.getByText(`connected as ${email}`)).toBeVisible()

  // leave this device → back to the start screen
  await page.getByRole('button', { name: 'leave this passport on this device' }).click()
  await expect(page.getByText('start anonymously — just pick a name')).toBeVisible()

  // sign back in — same passport, stamp still there
  await page.getByRole('button', { name: 'i already have a passport' }).click()
  await page.getByLabel('your email').fill(email)
  await page.getByRole('button', { name: 'send me a code' }).click()
  const signInCode = await otpFor(email, code)
  await page.getByLabel('6-digit code').fill(signInCode)
  await page.getByRole('button', { name: 'confirm' }).click()

  await expect(page.getByText('my journey')).toBeVisible()
  await expect(page.getByText('@e2e warrior')).toBeVisible()
  await expect(page.getByRole('button', { name: '2024', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(page.getByText(`connected as ${email}`)).toBeVisible()
})
