import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { eventIdByYear, serviceClient } from './fixtures'

/**
 * Admin journey — docs/17 T4.2. Non-operators are locked out; the operator
 * signs in, sees the queue and can hide a live moment, which removes it
 * from the public wall immediately.
 */

const OPERATOR = { email: 'op@onetribe.world', password: 'operator-e2e-pass-1' }

test.beforeAll(async () => {
  const service = serviceClient()
  // idempotent operator fixture matching ADMIN_EMAILS
  const { error } = await service.auth.admin.createUser({
    email: OPERATOR.email,
    password: OPERATOR.password,
    email_confirm: true,
  })
  if (error && !/already/i.test(error.message)) throw error
})

test('a non-operator cannot get past the sign-in form', async ({ page }) => {
  await page.goto('/en/admin')
  await expect(page.getByLabel('email')).toBeVisible()
  await page.getByLabel('email').fill('stranger@example.com')
  await page.getByLabel('password').fill('wrong-password')
  await page.getByRole('button', { name: 'sign in' }).click()
  await expect(page.getByText('sign-in failed')).toBeVisible()
})

test('the operator hides a reported moment and it leaves the wall', async ({ page }) => {
  const service = serviceClient()
  // unique per invocation — the mobile/desktop projects run this spec in
  // parallel against one DB, and Date.now() captions can collide across them
  const caption = `admin-e2e-${randomUUID().slice(0, 8)}`

  const { data: memory, error } = await service
    .from('memories')
    .insert({
      event_id: await eventIdByYear(service, 2015),
      media_kind: 'image',
      media_url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
      caption,
      rights_confirmed: true,
      status: 'live',
    })
    .select('id')
    .single()
  // Say so here. Unchecked, a refused seed (the media_url above is a constant,
  // so one leftover row blocks it forever) surfaces 20 lines down as a missing
  // card — which reads as a bug in the public wall.
  if (error) throw error

  try {
    // it is on the public wall first
    await page.goto('/en')
    await expect(page.getByText(caption).first()).toBeVisible()

    // operator signs in and hides it from the recent tab
    await page.goto('/en/admin')
    await page.getByLabel('email').fill(OPERATOR.email)
    await page.getByLabel('password').fill(OPERATOR.password)
    await page.getByRole('button', { name: 'sign in' }).click()
    await page.getByRole('button', { name: 'recent' }).click()

    const row = page.getByRole('listitem').filter({ hasText: caption })
    await expect(row).toBeVisible()
    await row.getByRole('button', { name: 'hide', exact: true }).click()
    await expect(row.getByRole('button', { name: 'unhide' })).toBeVisible()

    // gone from the public wall
    await page.goto('/en')
    await expect(page.getByText(caption)).toHaveCount(0)
  } finally {
    // non-null past the error check above
    await service.from('memories').delete().eq('id', memory!.id)
  }
})
