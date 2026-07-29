/**
 * `unstable_cache` tag names, shared between the cached read and every write
 * site that invalidates it, so a rename can't drift the two apart (docs/00 D41).
 * A zero-dependency leaf module: importing it never pulls in the cache reads'
 * server-only deps.
 */

/** Wall counters ("N moments · M countries"). Drop wherever the live moment
 *  count changes — publish, admin moderation, self-takedown, report auto-hide. */
export const COUNTERS_TAG = 'counters'
