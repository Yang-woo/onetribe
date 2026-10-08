/**
 * `unstable_cache` tag names, shared between the cached read and every write
 * site that invalidates it, so a rename can't drift the two apart (docs/00 D41).
 * A zero-dependency leaf module: importing it never pulls in the cache reads'
 * server-only deps.
 */

/** Wall counters ("N moments · M countries") and every cached moment page
 *  (docs/00 D62). Drop wherever a moment's public face changes — publish,
 *  admin moderation, self-takedown, report auto-hide, account anonymization.
 *  A missed drop leaves a taken-down moment, or an erased name, on its page. */
export const COUNTERS_TAG = 'counters'
