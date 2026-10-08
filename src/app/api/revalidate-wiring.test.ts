import { describe, expect, test, vi } from 'vitest'
import { COUNTERS_TAG } from '@/lib/cache-tags'

/**
 * Since docs/00 D62, COUNTERS_TAG also takes cached moment pages down. Each
 * route below is a few lines of wiring, and every handler test injects its own
 * `revalidate` — so swapping a route's for a no-op left unit, db and e2e green
 * (test review, 2026-10-08) while a reported, hidden, deleted or anonymized
 * moment stayed on its cached page. Same seam as memories/remove/route.test.ts,
 * for the rest of the write routes.
 */

const revalidateTag = vi.fn()
vi.mock('next/cache', () => ({ revalidateTag: (...args: unknown[]) => revalidateTag(...args) }))
vi.mock('@/lib/server/supabase', () => ({ createServiceRoleClient: () => ({}) }))
vi.mock('@/lib/storage', () => ({ createStorage: () => ({}) }))
vi.mock('@/lib/server/turnstile', () => ({ verifyTurnstile: async () => true }))
vi.mock('@/lib/server/upload-session', () => ({ uploadSessionSecret: () => 'secret' }))

const deps = vi.fn()
const capture = (d: unknown) => {
  deps(d)
  return async () => new Response('{}')
}
vi.mock('@/server/upload', () => ({
  createReportHandler: (d: unknown) => capture(d),
  createMemoriesHandler: (d: unknown) => capture(d),
}))
vi.mock('@/server/admin', () => ({
  adminEmailsFromEnv: () => [],
  createAdminActionHandler: (d: unknown) => capture(d),
}))
vi.mock('@/server/account', () => ({
  createAccountDeleteHandler: (d: unknown) => capture(d),
}))

describe('write routes hand their handler a revalidate that expires the moment caches now', () => {
  test.each([
    ['report', () => import('./report/route')],
    ['memories', () => import('./memories/route')],
    ['admin/action', () => import('./admin/action/route')],
    ['account/delete', () => import('./account/delete/route')],
  ])('POST /api/%s', async (_route, load) => {
    deps.mockClear()
    revalidateTag.mockClear()
    const { POST } = await load()
    await POST(new Request('http://localhost/api', { method: 'POST' }))

    const passed = deps.mock.calls[0][0] as { revalidate: (tag: string) => void }
    passed.revalidate(COUNTERS_TAG)
    // `expire: 0`: a stale-while-revalidate entry would serve the hidden or
    // erased moment once more while it re-renders.
    expect(revalidateTag).toHaveBeenCalledWith(COUNTERS_TAG, { expire: 0 })
  })
})
