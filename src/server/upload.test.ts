import { describe, expect, test } from 'vitest'
import {
  clampAspect,
  fillEmptyIdentity,
  normalizeInstagramLink,
  normalizeYoutubeUrl,
} from './upload'

// Pure link normalization — expectations derived from docs/00 D9 P7
// (YouTube only) and docs/15 §2 (optional IG link).

describe('normalizeYoutubeUrl', () => {
  test('canonical watch URLs pass through', () => {
    expect(normalizeYoutubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    )
  })

  test('short, mobile, shorts and live forms normalize to watch URLs', () => {
    expect(normalizeYoutubeUrl('https://youtu.be/dQw4w9WgXcQ')).toBe(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    )
    expect(normalizeYoutubeUrl('https://m.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    )
    expect(normalizeYoutubeUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    )
    expect(normalizeYoutubeUrl('https://www.youtube.com/live/dQw4w9WgXcQ')).toBe(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    )
  })

  test('other hosts and malformed input are rejected', () => {
    expect(normalizeYoutubeUrl('https://vimeo.com/12345')).toBeNull()
    expect(normalizeYoutubeUrl('https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ')).toBeNull()
    expect(normalizeYoutubeUrl('https://www.youtube.com/watch')).toBeNull()
    expect(normalizeYoutubeUrl('not a url')).toBeNull()
    expect(normalizeYoutubeUrl('javascript:alert(1)')).toBeNull()
  })
})

describe('normalizeInstagramLink', () => {
  test('handles with or without @ become profile URLs', () => {
    expect(normalizeInstagramLink('@onetribe.world')).toBe('https://instagram.com/onetribe.world')
    expect(normalizeInstagramLink('onetribe.world')).toBe('https://instagram.com/onetribe.world')
  })

  test('instagram.com profile URLs are normalized', () => {
    expect(normalizeInstagramLink('https://www.instagram.com/onetribe.world/')).toBe(
      'https://instagram.com/onetribe.world',
    )
  })

  test('other hosts and junk are rejected', () => {
    expect(normalizeInstagramLink('https://evil.com/onetribe')).toBeNull()
    expect(normalizeInstagramLink('https://instagram.com/a/b/c')).toBeNull()
    expect(normalizeInstagramLink('<script>')).toBeNull()
  })
})

// Media aspect ratio (docs/00 D32) — clamped to a sane band, never trusted.
describe('clampAspect', () => {
  test('keeps an in-range ratio, rounded to 3 dp (docs/00 D32)', () => {
    expect(clampAspect(1.3333333)).toBe(1.333)
    expect(clampAspect(0.75)).toBe(0.75)
    expect(clampAspect(1)).toBe(1)
  })
  test('nulls out-of-range, absent and non-finite values (never distort a card)', () => {
    expect(clampAspect(undefined)).toBeNull()
    expect(clampAspect(0)).toBeNull()
    expect(clampAspect(0.1)).toBeNull() // below the portrait floor
    expect(clampAspect(6)).toBeNull() // above the landscape ceiling
    expect(clampAspect(Number.NaN)).toBeNull()
    expect(clampAspect(Number.POSITIVE_INFINITY)).toBeNull()
  })
  test('accepts the exact boundaries', () => {
    expect(clampAspect(0.2)).toBe(0.2)
    expect(clampAspect(5)).toBe(5)
  })
})

// The passport "fill-empty" identity write-back (docs/00 D30, D31): a field is
// registered only when the upload supplies it AND the profile has none yet.
describe('fillEmptyIdentity', () => {
  const empty = { display_name: null, instagram: null, home_country: null }

  test('the first upload fills every empty field', () => {
    expect(fillEmptyIdentity(empty, { name: 'Neo', handle: 'neo', country: 'NL' })).toEqual({
      display_name: 'Neo',
      instagram: 'neo',
      home_country: 'NL',
    })
    // no profile row yet behaves like an all-empty profile
    expect(fillEmptyIdentity(null, { name: 'Neo', country: 'KR' })).toEqual({
      display_name: 'Neo',
      home_country: 'KR',
    })
  })

  test('never overwrites a field the profile already has', () => {
    const current = { display_name: 'Set', instagram: 'set_ig', home_country: 'DE' }
    expect(fillEmptyIdentity(current, { name: 'New', handle: 'new_ig', country: 'NL' })).toEqual({})
  })

  test('fills each field independently — only the empty ones', () => {
    const current = { display_name: 'Set', instagram: null, home_country: null }
    expect(fillEmptyIdentity(current, { name: 'New', handle: 'new_ig', country: 'NL' })).toEqual({
      instagram: 'new_ig',
      home_country: 'NL',
    })
  })

  test('an absent upload value contributes nothing (no null writes)', () => {
    expect(fillEmptyIdentity(empty, { country: 'NL' })).toEqual({ home_country: 'NL' })
    expect(fillEmptyIdentity(empty, {})).toEqual({})
    expect(fillEmptyIdentity(empty, { name: '', handle: '', country: null })).toEqual({})
  })
})
