import { describe, expect, it } from 'vitest'
import {
  countryFlag,
  countryName,
  countryOptions,
  filterCountries,
  ISO_COUNTRY_CODES,
  isValidCountry,
  normalizeCountry,
} from './country'

describe('isValidCountry', () => {
  it('accepts assigned upper-case codes', () => {
    expect(isValidCountry('KR')).toBe(true)
    expect(isValidCountry('NL')).toBe(true)
  })

  it('rejects unassigned, placeholder, and malformed codes', () => {
    expect(isValidCountry('XX')).toBe(false) // request-meta's "unknown" sentinel
    expect(isValidCountry('ZZ')).toBe(false)
    expect(isValidCountry('kr')).toBe(false) // canonical set is upper-case only
    expect(isValidCountry('K')).toBe(false)
    expect(isValidCountry('KOR')).toBe(false)
    expect(isValidCountry('')).toBe(false)
  })
})

describe('normalizeCountry', () => {
  it('coerces case and whitespace to a canonical code', () => {
    expect(normalizeCountry('kr')).toBe('KR')
    expect(normalizeCountry('  nl ')).toBe('NL')
    expect(normalizeCountry('NL')).toBe('NL')
  })

  it('returns null for anything not an assigned country', () => {
    expect(normalizeCountry('XX')).toBeNull()
    expect(normalizeCountry('zz')).toBeNull()
    expect(normalizeCountry('')).toBeNull()
    expect(normalizeCountry(null)).toBeNull()
    expect(normalizeCountry(undefined)).toBeNull()
    expect(normalizeCountry('not a country')).toBeNull()
  })
})

describe('countryFlag', () => {
  it('maps a code to its regional-indicator emoji', () => {
    expect(countryFlag('NL')).toBe('\u{1F1F3}\u{1F1F1}')
    expect(countryFlag('KR')).toBe('\u{1F1F0}\u{1F1F7}')
    expect(countryFlag('kr')).toBe('\u{1F1F0}\u{1F1F7}') // case-insensitive
  })

  it('returns empty string for non 2-letter input', () => {
    expect(countryFlag('KOR')).toBe('')
    expect(countryFlag('1')).toBe('')
    expect(countryFlag('')).toBe('')
  })
})

describe('countryName', () => {
  it('localizes via ICU', () => {
    expect(countryName('FR', 'en')).toBe('France')
    expect(countryName('NL', 'en')).toBe('Netherlands')
    const ko = countryName('KR', 'ko')
    expect(ko).not.toBe('KR')
    expect(ko.length).toBeGreaterThan(0)
  })
})

describe('countryOptions', () => {
  it('lists every code once, flagged, sorted by localized name', () => {
    const opts = countryOptions('en')
    expect(opts).toHaveLength(ISO_COUNTRY_CODES.size)
    expect(new Set(opts.map((o) => o.code)).size).toBe(ISO_COUNTRY_CODES.size)
    expect(opts.every((o) => o.flag.length > 0)).toBe(true)
    const names = opts.map((o) => o.name)
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'en')))
  })

  it('carries the English name and a folded search term list', () => {
    const kr = countryOptions('ko').find((o) => o.code === 'KR')!
    expect(kr.en).toBe('South Korea')
    expect(kr.name).not.toBe('KR') // localized (Korean) name, not the code
    expect(kr.terms).toContain('south korea')
    expect(kr.terms).toContain('kr')
  })
})

describe('filterCountries', () => {
  const en = countryOptions('en')

  it('matches the English name and common aliases (what people actually type)', () => {
    expect(filterCountries('korea', en).map((o) => o.code)).toEqual(
      expect.arrayContaining(['KR', 'KP']),
    )
    expect(filterCountries('holland', en).map((o) => o.code)).toContain('NL')
    expect(filterCountries('uk', en).map((o) => o.code)).toContain('GB')
    expect(filterCountries('america', en).map((o) => o.code)).toContain('US')
    expect(filterCountries('turkey', en).map((o) => o.code)).toContain('TR')
  })

  it('matches the localized name and the code', () => {
    const ko = countryOptions('ko')
    expect(filterCountries('한국', ko).map((o) => o.code)).toContain('KR')
    expect(filterCountries('kr', ko).map((o) => o.code)).toContain('KR')
  })

  it('folds accents so plain-ASCII typing matches an accented name', () => {
    const fr = countryOptions('fr')
    // "Suède" (Sweden, in French) reachable by "suede"
    expect(filterCountries('suede', fr).map((o) => o.code)).toContain('SE')
  })

  it('returns all on empty query and none on gibberish', () => {
    expect(filterCountries('', en)).toHaveLength(en.length)
    expect(filterCountries('   ', en)).toHaveLength(en.length)
    expect(filterCountries('zzzznotacountry', en)).toHaveLength(0)
  })
})
