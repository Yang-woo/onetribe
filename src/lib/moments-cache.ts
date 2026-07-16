import { unstable_cache } from 'next/cache'
import { fetchCounters, fetchEditions } from '@/lib/moments'
import { supabaseServerAnon } from '@/lib/supabase/server-anon'

/**
 * Cached reads for the data that is NOT filter-specific, so an edition filter
 * click doesn't re-hit Supabase for it (docs/15 §1 perf). Only the moments
 * query stays dynamic per request.
 *
 * - editions: seed data, changes only when a migration runs → long revalidate.
 * - counters: a global vanity number → a minute of staleness is fine.
 *
 * Safe under `unstable_cache`: the anon client reads only env (no cookies/
 * headers), so nothing request-scoped leaks into the cache.
 */
export const getCachedEditions = unstable_cache(
  () => fetchEditions(supabaseServerAnon()),
  ['wall-editions'],
  { revalidate: 3600, tags: ['editions'] },
)

export const getCachedCounters = unstable_cache(
  () => fetchCounters(supabaseServerAnon()),
  ['wall-counters'],
  { revalidate: 60, tags: ['counters'] },
)
