import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { eventIdByYear, seedMemory, serviceClient } from './fixtures'

/**
 * Removing your own moment from the passport (docs/00 D54). The
 * uploader who asked for this had already lost the one-time takedown link from
 * the confirmation screen; the passport is the page they still have.
 *
 * Only a real browser proves the whole chain: a genuine anonymous session,
 * the bearer it attaches, the Next route handler, the scoped write, and the
 * grid re-rendering without the moment. The DB suite calls the handler
 * directly, so the route itself is untested until here.
 *
 * Seeded rather than uploaded — the wizard would burn the per-IP upload rate
 * limit that upload.spec.ts needs, and the upload path is not what's under test.
 */

const svgDataUri = (tag: string) =>
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" data-fixture="${tag}"><rect width="100%" height="100%" fill="#FF6A00"/></svg>`,
  )

test('an uploader removes their own moment from the passport', async ({ page }) => {
  const service = serviceClient()
  const stamp = randomUUID().slice(0, 8)
  const name = `remover-${stamp}`
  const caption = `mistake-${stamp}`
  const keeper = `keeper-${stamp}`
  let memoryId: string | undefined
  let keeperId: string | undefined

  try {
    // a real passport, minted in the browser like any visitor's
    await page.goto('/en/passport')
    await page.getByLabel('your name on the wall').fill(name)
    await page.getByRole('button', { name: 'create my passport' }).click()
    await expect(page.getByText('my journey')).toBeVisible()

    // whose id we look up the same way the app does — through its profile row
    const { data: profile } = await service
      .from('profiles')
      .select('id')
      .eq('display_name', name)
      .single()
    expect(profile?.id).toBeTruthy()

    const eventId = await eventIdByYear(service, 2024)
    // two moments, so "the grid re-rendered" is distinguishable from
    // "the grid emptied"
    memoryId = await seedMemory(service, {
      event_id: eventId,
      caption,
      author_id: profile!.id,
      media_url: svgDataUri(caption),
    })
    keeperId = await seedMemory(service, {
      event_id: eventId,
      caption: keeper,
      author_id: profile!.id,
      media_url: svgDataUri(keeper),
    })

    await page.reload()
    await expect(page.getByText('my moments (2)')).toBeVisible()

    // open the one that was a mistake and take it down
    await page.getByRole('button', { name: caption }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'remove this moment' }).click()
    await dialog.getByRole('button', { name: 'yes, remove it' }).click()

    // the modal closes because the moment left the list — no separate "close"
    await expect(page.getByRole('dialog')).toBeHidden()
    await expect(page.getByRole('button', { name: caption })).toBeHidden()
    await expect(page.getByRole('button', { name: keeper })).toBeVisible()
    await expect(page.getByText('my moments (1)')).toBeVisible()

    // hidden, not deleted (docs/09 C) — and it stays gone across a reload,
    // which is what separates a real write from a local state change
    const { data: row } = await service
      .from('memories')
      .select('status')
      .eq('id', memoryId)
      .single()
    expect(row?.status).toBe('hidden')
    await page.reload()
    await expect(page.getByText('my moments (1)')).toBeVisible()
    await expect(page.getByRole('button', { name: caption })).toBeHidden()
  } finally {
    const ids = [memoryId, keeperId].filter(Boolean) as string[]
    if (ids.length) await service.from('memories').delete().in('id', ids)
    const { data: profile } = await service
      .from('profiles')
      .select('id')
      .eq('display_name', name)
      .maybeSingle()
    if (profile?.id) await service.auth.admin.deleteUser(profile.id).catch(() => {})
  }
})
