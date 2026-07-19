import { describe, expect, test } from 'vitest'
import type { EditionChip } from './moments'
import { parseEditionYear, wallFilterFor } from './moments'

// Spec: docs/15 §1 — the wall's filter state lives in the URL (?e=YYYY).
// Both readers (the server page's searchParams and the client filter's
// popstate, docs/00 D13) share this parser, so a hand-typed or stale URL can
// never mean one thing to the server and another to the browser.

describe('parseEditionYear', () => {
  test('a four-digit year is the filter', () => {
    expect(parseEditionYear('2026')).toBe(2026)
  })

  test('a missing param means no filter', () => {
    expect(parseEditionYear(null)).toBeNull()
    expect(parseEditionYear(undefined)).toBeNull()
    expect(parseEditionYear('')).toBeNull()
  })

  // Anything else falls back to the unfiltered wall rather than reaching the
  // DB as a junk year.
  test.each(['abc', '20261', '202', '20.6', ' 2026', '2026a', '-202'])(
    'junk (%s) reads as no filter',
    (value) => {
      expect(parseEditionYear(value)).toBeNull()
    },
  )
})

// The year → wall-props derivation the server page and the client filter share
// (docs/00 D13), so a deep-linked wall and a post-click wall can't drift.
describe('wallFilterFor', () => {
  const editions: EditionChip[] = [
    { id: 'e2026', year: 2026, edition: 'Sacred Oath', canceled: true },
    { id: 'e2025', year: 2025, edition: 'Where Legends Rise', canceled: false },
    { id: 'e2024', year: 2024, edition: 'Power of the Tribe', canceled: false },
  ]

  test('a year resolves to its events and its edition', () => {
    const { eventIds, filterEdition } = wallFilterFor(editions, 2025)
    expect(eventIds).toEqual(['e2025'])
    expect(filterEdition).toEqual(editions[1])
  })

  test('no year means no filter — undefined eventIds and edition', () => {
    const { eventIds, filterEdition } = wallFilterFor(editions, null)
    expect(eventIds).toBeUndefined() // "all", not an empty IN-list
    expect(filterEdition).toBeUndefined()
  })

  test('editionById covers every edition regardless of the year', () => {
    const { editionById } = wallFilterFor(editions, 2025)
    expect(editionById.get('e2024')).toEqual(editions[2])
    expect(editionById.size).toBe(3)
  })
})
