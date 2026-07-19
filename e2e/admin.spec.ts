import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { expect, test } from '@playwright/test'

/**
 * Admin journey — docs/17 T4.2. Non-operators are locked out; the operator
 * signs in, sees the queue and can hide a live moment, which removes it
 * from the public wall immediately.
 */

function localEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const match = line.match(/^([A-Z_]+)=(.*)$/)
    if (match) env[match[1]] = match[2]
  }
  return env
}

const OPERATOR = { email: 'op@onetribe.world', password: 'operator-e2e-pass-1' }

test.beforeAll(async () => {
  const env = localEnv()
  const service = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
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
  const env = localEnv()
  const service = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
  const caption = `admin-e2e-${Date.now()}`

  const { data: event } = await service
    .from('events')
    .select('id')
    .eq('festival', 'Defqon.1')
    .eq('year', 2015)
    .single()
  const { data: memory } = await service
    .from('memories')
    .insert({
      event_id: event!.id,
      media_kind: 'image',
      media_url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
      caption,
      rights_confirmed: true,
      status: 'live',
    })
    .select('id')
    .single()

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
    await service.from('memories').delete().eq('id', memory!.id)
  }
})
