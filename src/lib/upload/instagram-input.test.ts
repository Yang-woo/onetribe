import { describe, expect, test } from 'vitest'
import { IG_HANDLE_RE, isIgHandleInvalid, isIgUrl, normalizeIgInput } from './instagram-input'

/**
 * The segmented "@" prefix means the field holds a bare handle; anything a
 * user reasonably pastes (typed @, profile URL) must collapse to that handle,
 * and anything else must pass through untouched so the invalid hint can show.
 */
describe('normalizeIgInput', () => {
  test('leaves a plain handle untouched', () => {
    expect(normalizeIgInput('qdance')).toBe('qdance')
  })

  test('strips a leading @', () => {
    expect(normalizeIgInput('@qdance')).toBe('qdance')
  })

  test('extracts the handle from a full profile URL', () => {
    expect(normalizeIgInput('https://www.instagram.com/defqon1')).toBe('defqon1')
  })

  test('extracts from a protocol-less URL (the server alone would reject this)', () => {
    expect(normalizeIgInput('instagram.com/defqon1')).toBe('defqon1')
  })

  test('tolerates trailing slash and query on a pasted URL', () => {
    expect(normalizeIgInput('https://instagram.com/defqon1/?igsh=abc')).toBe('defqon1')
  })

  test('collapses an @-prefixed profile URL path', () => {
    expect(normalizeIgInput('instagram.com/@defqon1')).toBe('defqon1')
  })

  // Pre-prefix regression guards: the old field sent the raw URL to the
  // server, where new URL() trims whitespace and ignores query/fragment —
  // the live collapse must stay at least as forgiving.
  test('tolerates a trailing space/newline paste artifact', () => {
    expect(normalizeIgInput('https://instagram.com/defqon1 ')).toBe('defqon1')
  })

  test('tolerates a #fragment and a query containing slashes', () => {
    expect(normalizeIgInput('https://instagram.com/defqon1#')).toBe('defqon1')
    expect(normalizeIgInput('https://instagram.com/defqon1?next=/x/y')).toBe('defqon1')
  })

  test('leaves a post URL alone — no wrong-handle extraction', () => {
    const post = 'https://instagram.com/p/Cxyz123'
    expect(normalizeIgInput(post)).toBe(post)
  })

  test('does not strip @ mid-string', () => {
    expect(normalizeIgInput('mail@example')).toBe('mail@example')
  })

  test('trims leading whitespace only — the user may still be typing', () => {
    expect(normalizeIgInput('  qdance')).toBe('qdance')
  })

  test('passes an empty field through', () => {
    expect(normalizeIgInput('')).toBe('')
  })
})

describe('IG_HANDLE_RE', () => {
  test('accepts letters, digits, dots and underscores up to 30 chars', () => {
    expect(IG_HANDLE_RE.test('the_gathering.2026')).toBe(true)
    expect(IG_HANDLE_RE.test('a'.repeat(30))).toBe(true)
  })

  test('rejects spaces, symbols, and overlong handles', () => {
    expect(IG_HANDLE_RE.test('bad handle!')).toBe(false)
    expect(IG_HANDLE_RE.test('a'.repeat(31))).toBe(false)
    expect(IG_HANDLE_RE.test('')).toBe(false)
  })

  // Instagram forbids these — the derived-link hint says "that's my
  // profile", so it must not endorse a handle that cannot exist.
  test('rejects leading, trailing, and consecutive dots', () => {
    expect(IG_HANDLE_RE.test('.qdance')).toBe(false)
    expect(IG_HANDLE_RE.test('qdance.')).toBe(false)
    expect(IG_HANDLE_RE.test('q..dance')).toBe(false)
  })
})

// The one rule the upload wizard and the passport editor both gate submit on
// (docs/00 D30) — empty is allowed (the field is optional), a bad handle is not.
describe('isIgHandleInvalid', () => {
  test('an empty field is not invalid — instagram is optional', () => {
    expect(isIgHandleInvalid('')).toBe(false)
    expect(isIgHandleInvalid('   ')).toBe(false)
  })

  test('a valid bare handle is not invalid', () => {
    expect(isIgHandleInvalid('onetribe_world')).toBe(false)
  })

  test('flags a handle Instagram itself forbids', () => {
    expect(isIgHandleInvalid('bad handle!')).toBe(true)
    expect(isIgHandleInvalid('qdance.')).toBe(true)
    expect(isIgHandleInvalid('a'.repeat(31))).toBe(true)
  })
})

describe('isIgUrl', () => {
  test('recognizes non-profile instagram URLs (for the dedicated hint)', () => {
    expect(isIgUrl('https://instagram.com/p/Cxyz123')).toBe(true)
    expect(isIgUrl('instagram.com/reel/abc ')).toBe(true)
  })

  test('is false for handles and other hosts', () => {
    expect(isIgUrl('qdance')).toBe(false)
    expect(isIgUrl('https://evil.com/instagram.com/x')).toBe(false)
  })
})
