import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import sitemap from '@/app/sitemap'
import { createServiceClient, eventIdByYear, seedMemory } from './helpers'

/**
 * docs/00 D23 — /sitemap.xml is a public artifact built from a DB read, so
 * it must go through the anon path (RLS: live only). This calls the real
 * sitemap() against the real local stack: if anyone swaps its client for
 * the service role, hidden (taken-down) moments leak into the sitemap and
 * this goes red. No unit mock can catch that swap.
 */

const service = createServiceClient()

let liveId: string
let hiddenId: string

beforeAll(async () => {
  // sitemap() reads the app's public env names; the db harness resolves the
  // same local stack under SUPABASE_* (global-setup) — bridge them here.
  process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.SUPABASE_URL
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY

  const eventId = await eventIdByYear(service, 2019)
  liveId = await seedMemory(service, { event_id: eventId, caption: 'sitemap-live' })
  hiddenId = await seedMemory(service, {
    event_id: eventId,
    caption: 'sitemap-hidden',
    status: 'hidden',
  })
})

afterAll(async () => {
  await service.from('memories').delete().in('id', [liveId, hiddenId])
})

describe('sitemap.xml source', () => {
  test('live moments are listed; hidden moments never leak', async () => {
    const entries = await sitemap()
    const urls = entries.map((e) => e.url)
    expect(urls.some((u) => u.endsWith(`/m/${liveId}`))).toBe(true)
    expect(urls.some((u) => u.endsWith(`/m/${hiddenId}`))).toBe(false)
  })
})
