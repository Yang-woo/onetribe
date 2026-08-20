import { describe, expect, test, vi } from 'vitest'
import { COUNTERS_TAG } from '@/lib/cache-tags'

/**
 * The route module is three lines of wiring, and one of them is the only thing
 * that keeps the wall's header honest after a removal. Every other test in this
 * feature injects `revalidate` — so replacing this file's with a no-op leaves
 * unit, db AND e2e entirely green while the counter silently goes stale
 * (docs/00 D41, where exactly this wiring was once missed on a write path).
 *
 * The wall counter is a global aggregate, so an e2e assertion on it races the
 * other Playwright project seeding into the same database. Pinning the seam
 * here is the version that can actually fail for the right reason.
 */

const revalidateTag = vi.fn()
vi.mock('next/cache', () => ({ revalidateTag: (...args: unknown[]) => revalidateTag(...args) }))
vi.mock('@/lib/server/supabase', () => ({ createServiceRoleClient: () => ({}) }))

const handler = vi.fn(async () => new Response('{}'))
const deps = vi.fn()
vi.mock('@/server/moments', () => ({
  createMomentRemoveHandler: (d: unknown) => {
    deps(d)
    return handler
  },
}))

describe('POST /api/memories/remove wiring', () => {
  test('hands the handler a revalidate that expires the wall counter now', async () => {
    const { POST } = await import('./route')
    await POST(new Request('http://localhost/api/memories/remove', { method: 'POST' }))

    const passed = deps.mock.calls[0][0] as { revalidate: (tag: string) => void }
    expect(passed.revalidate).toBeTypeOf('function')

    passed.revalidate(COUNTERS_TAG)
    // `expire: 0`, not the default: the person who just removed a moment is the
    // most likely next reader of the count, and a stale-while-revalidate entry
    // would serve them the old number once more (same reasoning as the publish
    // path in api/memories/route.ts).
    expect(revalidateTag).toHaveBeenCalledWith(COUNTERS_TAG, { expire: 0 })
  })
})
