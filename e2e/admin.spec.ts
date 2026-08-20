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
      // unique for the same reason the caption is: media_url carries a UNIQUE
      // index (migration 20260725000200), so a constant here makes the two
      // projects race for one row — the loser gets 23505 — and any leftover
      // row from a killed run blocks the spec forever after.
      media_url: `https://i.ytimg.com/vi/${caption}/hqdefault.jpg`,
      caption,
      rights_confirmed: true,
      status: 'live',
    })
    .select('id')
    .single()
  // Say so here. Unchecked, a refused seed surfaces 20 lines down as a missing
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

/**
 * Restoring is the one action in this console that can undo somebody else's
 * decision (docs/00 D55). A moment its author took down sorts to the top of the
 * list with no reports attached — indistinguishable, before `hidden_reason`,
 * from a false-positive auto-hide — and `h` is one keypress from putting it
 * back on the public wall.
 */
test('an author’s own removal is labelled, and restoring it asks first', async ({ page }) => {
  const service = serviceClient()
  const caption = `owner-hidden-${randomUUID().slice(0, 8)}`

  const { data: memory, error } = await service
    .from('memories')
    .insert({
      event_id: await eventIdByYear(service, 2015),
      media_kind: 'image',
      media_url: `https://i.ytimg.com/vi/${caption}/hqdefault.jpg`,
      caption,
      rights_confirmed: true,
      status: 'hidden',
      hidden_reason: 'owner',
    })
    .select('id')
    .single()
  if (error) throw error

  try {
    await page.goto('/en/admin')
    await page.getByLabel('email').fill(OPERATOR.email)
    await page.getByLabel('password').fill(OPERATOR.password)
    await page.getByRole('button', { name: 'sign in' }).click()
    await page.getByRole('button', { name: 'recent' }).click()

    const row = page.getByRole('listitem').filter({ hasText: caption })
    // the operator can see WHY it is down before deciding anything
    await expect(row).toContainText('(owner)')

    // Count the writes rather than watching the row: the console reloads its
    // queue asynchronously, so "the button still says unhide" is true for a
    // moment even when the write DID go out — an assertion that passes for a
    // console with no prompt at all.
    let writes = 0
    page.on('request', (req) => {
      if (req.method() === 'POST' && req.url().includes('/api/admin/action')) writes++
    })

    // dismissing the prompt must send nothing
    page.once('dialog', (dialog) => dialog.dismiss())
    await row.getByRole('button', { name: 'unhide' }).click()

    // accepting goes through — the gate is a question, not a lock. Waiting on
    // the response is also the settle point for the dismissal above: if that
    // click had leaked a write, this count would be 2.
    page.once('dialog', (dialog) => dialog.accept())
    await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes('/api/admin/action') && res.request().method() === 'POST',
      ),
      row.getByRole('button', { name: 'unhide' }).click(),
    ])
    expect(writes).toBe(1)
    await expect(row.getByRole('button', { name: 'hide', exact: true })).toBeVisible()
    const restored = await service
      .from('memories')
      .select('status, hidden_reason')
      .eq('id', memory!.id)
      .single()
    expect(restored.data).toEqual({ status: 'live', hidden_reason: null })
  } finally {
    await service.from('memories').delete().eq('id', memory!.id)
  }
})
