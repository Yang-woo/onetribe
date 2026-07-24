import { describe, expect, test } from 'vitest'
import { editionLine, instagramHandle } from './format'

// The display name and the Instagram handle are distinct fields (docs/00 D30):
// the @ prefix must sit on the handle derived from author_link, never on the name.
describe('instagramHandle', () => {
  test('extracts the bare handle from a stored profile URL', () => {
    expect(instagramHandle('https://instagram.com/lee_yangwoo')).toBe('lee_yangwoo')
    expect(instagramHandle('https://instagram.com/lee_yangwoo/')).toBe('lee_yangwoo')
  })

  test('null when there is no link or it does not parse', () => {
    expect(instagramHandle(null)).toBeNull()
    expect(instagramHandle(undefined)).toBeNull()
    expect(instagramHandle('')).toBeNull()
    expect(instagramHandle('not a url')).toBeNull()
    expect(instagramHandle('https://instagram.com/')).toBeNull() // no handle in the path
  })
})

describe('editionLine', () => {
  test('joins year and anthem, or just the year when there is no anthem', () => {
    expect(editionLine({ year: 2024, edition: 'Power of the Tribe' })).toBe(
      '2024 — Power of the Tribe',
    )
    expect(editionLine({ year: 2021, edition: null })).toBe('2021')
  })
})
