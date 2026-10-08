import type { SupabaseClient } from '@supabase/supabase-js'
import { expect, test } from 'vitest'
import { COUNTERS_TAG } from '@/lib/cache-tags'
import { createTakedown } from './takedown'

/**
 * The token link's form action (docs/17 T1.5), the branches the real stack
 * can't reach on demand — tests/db/takedown.test.ts covers the live/hidden
 * reads and the replay. A live read that fails must still drop: missing a real
 * takedown leaves the moment on its cached page (docs/00 D62). And an RPC
 * failure is a retry, not a bad link, and changed nothing to drop.
 */

// the live read fails; the RPC answers as given
const blind = (rpc: { data: unknown; error: unknown }) =>
  ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: { message: 'boom' } }),
        }),
      }),
    }),
    rpc: async () => rpc,
  }) as unknown as SupabaseClient

test.each([
  [
    'a takedown whose live read failed still drops',
    { data: true, error: null },
    '1',
    [COUNTERS_TAG],
  ],
  [
    'an RPC failure is a retry, not a bad link, and drops nothing',
    { data: null, error: { message: 'down' } },
    'error',
    [],
  ],
] as const)('%s', async (_label, rpc, done, dropped) => {
  const seen: string[] = []
  const takedown = createTakedown({ db: blind(rpc), revalidate: (tag) => void seen.push(tag) })
  expect(await takedown('id', 'token')).toBe(done)
  expect(seen).toEqual(dropped)
})
