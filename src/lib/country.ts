/**
 * Country helpers — ISO 3166-1 alpha-2. Backs the "where you're from" field
 * (docs/00 D31): the upload/passport picker, client + server validation (one
 * canonical set, no drift — mirrors IG_HANDLE_RE), and the wall's flag.
 *
 * Country NAMES are deliberately NOT shipped: Intl.DisplayNames localizes them
 * at runtime across all 17 locales, so there is no 249×17 translation table to
 * hand-maintain (docs/00 D19/D30 keep hand-authored strings small).
 */

// The 249 officially-assigned ISO 3166-1 alpha-2 codes. Territories are kept in
// (Intl.DisplayNames names them all) — harmless for a "where you're from" pick.
const CODES = [
  'AD',
  'AE',
  'AF',
  'AG',
  'AI',
  'AL',
  'AM',
  'AO',
  'AQ',
  'AR',
  'AS',
  'AT',
  'AU',
  'AW',
  'AX',
  'AZ',
  'BA',
  'BB',
  'BD',
  'BE',
  'BF',
  'BG',
  'BH',
  'BI',
  'BJ',
  'BL',
  'BM',
  'BN',
  'BO',
  'BQ',
  'BR',
  'BS',
  'BT',
  'BV',
  'BW',
  'BY',
  'BZ',
  'CA',
  'CC',
  'CD',
  'CF',
  'CG',
  'CH',
  'CI',
  'CK',
  'CL',
  'CM',
  'CN',
  'CO',
  'CR',
  'CU',
  'CV',
  'CW',
  'CX',
  'CY',
  'CZ',
  'DE',
  'DJ',
  'DK',
  'DM',
  'DO',
  'DZ',
  'EC',
  'EE',
  'EG',
  'EH',
  'ER',
  'ES',
  'ET',
  'FI',
  'FJ',
  'FK',
  'FM',
  'FO',
  'FR',
  'GA',
  'GB',
  'GD',
  'GE',
  'GF',
  'GG',
  'GH',
  'GI',
  'GL',
  'GM',
  'GN',
  'GP',
  'GQ',
  'GR',
  'GS',
  'GT',
  'GU',
  'GW',
  'GY',
  'HK',
  'HM',
  'HN',
  'HR',
  'HT',
  'HU',
  'ID',
  'IE',
  'IL',
  'IM',
  'IN',
  'IO',
  'IQ',
  'IR',
  'IS',
  'IT',
  'JE',
  'JM',
  'JO',
  'JP',
  'KE',
  'KG',
  'KH',
  'KI',
  'KM',
  'KN',
  'KP',
  'KR',
  'KW',
  'KY',
  'KZ',
  'LA',
  'LB',
  'LC',
  'LI',
  'LK',
  'LR',
  'LS',
  'LT',
  'LU',
  'LV',
  'LY',
  'MA',
  'MC',
  'MD',
  'ME',
  'MF',
  'MG',
  'MH',
  'MK',
  'ML',
  'MM',
  'MN',
  'MO',
  'MP',
  'MQ',
  'MR',
  'MS',
  'MT',
  'MU',
  'MV',
  'MW',
  'MX',
  'MY',
  'MZ',
  'NA',
  'NC',
  'NE',
  'NF',
  'NG',
  'NI',
  'NL',
  'NO',
  'NP',
  'NR',
  'NU',
  'NZ',
  'OM',
  'PA',
  'PE',
  'PF',
  'PG',
  'PH',
  'PK',
  'PL',
  'PM',
  'PN',
  'PR',
  'PS',
  'PT',
  'PW',
  'PY',
  'QA',
  'RE',
  'RO',
  'RS',
  'RU',
  'RW',
  'SA',
  'SB',
  'SC',
  'SD',
  'SE',
  'SG',
  'SH',
  'SI',
  'SJ',
  'SK',
  'SL',
  'SM',
  'SN',
  'SO',
  'SR',
  'SS',
  'ST',
  'SV',
  'SX',
  'SY',
  'SZ',
  'TC',
  'TD',
  'TF',
  'TG',
  'TH',
  'TJ',
  'TK',
  'TL',
  'TM',
  'TN',
  'TO',
  'TR',
  'TT',
  'TV',
  'TW',
  'TZ',
  'UA',
  'UG',
  'UM',
  'US',
  'UY',
  'UZ',
  'VA',
  'VC',
  'VE',
  'VG',
  'VI',
  'VN',
  'VU',
  'WF',
  'WS',
  'YE',
  'YT',
  'ZA',
  'ZM',
  'ZW',
] as const

export const ISO_COUNTRY_CODES: ReadonlySet<string> = new Set(CODES)

/** True for a canonical (upper-case, assigned) alpha-2 code. */
export function isValidCountry(code: string): boolean {
  return ISO_COUNTRY_CODES.has(code)
}

/**
 * Coerce arbitrary input to a canonical code, or null. This is the gate for
 * client-supplied country before it becomes memories.origin_country (D31):
 * anything not an assigned country (incl. request-meta's 'XX' sentinel) is
 * rejected so the "M countries" counter can't be polluted with junk codes.
 */
export function normalizeCountry(raw: string | null | undefined): string | null {
  if (!raw) return null
  const code = raw.trim().toUpperCase()
  return ISO_COUNTRY_CODES.has(code) ? code : null
}

/** Regional-indicator flag emoji for a code, or '' if not a 2-letter code. */
export function countryFlag(code: string): string {
  const cc = code.toUpperCase()
  if (!/^[A-Z]{2}$/.test(cc)) return ''
  return String.fromCodePoint(0x1f1e6 + cc.charCodeAt(0) - 65, 0x1f1e6 + cc.charCodeAt(1) - 65)
}

/** Localized country name via the platform's ICU data; falls back to the code. */
export function countryName(code: string, locale: string): string {
  const cc = code.toUpperCase()
  try {
    return new Intl.DisplayNames([locale], { type: 'region' }).of(cc) ?? cc
  } catch {
    return cc
  }
}

/**
 * Aliases — what people actually type instead of the official/localized name
 * (docs/00 D31). Folded and matched alongside the localized name, English name
 * and code so "holland" / "uk" / "usa" / "korea" / "한국" all resolve. Not
 * exhaustive — extend as real misses surface.
 */
export const COUNTRY_ALIASES: Record<string, string[]> = {
  KR: ['korea', 'south korea', '한국', '남한', '대한민국'],
  KP: ['north korea', '북한'],
  GB: ['uk', 'britain', 'great britain', 'england', 'scotland', 'wales'],
  US: ['usa', 'us', 'america', 'united states'],
  NL: ['holland', 'the netherlands'],
  RU: ['russia'],
  CZ: ['czech', 'czech republic'],
  AE: ['uae', 'emirates'],
  VN: ['vietnam'],
  LA: ['laos'],
  SY: ['syria'],
  VE: ['venezuela'],
  TW: ['taiwan'],
  IR: ['iran'],
  BO: ['bolivia'],
  TZ: ['tanzania'],
  MD: ['moldova'],
  TR: ['turkey', 'turkiye'],
  CI: ['ivory coast'],
  CV: ['cape verde'],
  SZ: ['swaziland'],
}

/** Case- and accent-insensitive fold for search matching. */
function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()
}

export interface CountryOption {
  code: string
  /** Localized name (viewer's locale). */
  name: string
  /** English name — shown as a secondary label when it differs from `name`. */
  en: string
  flag: string
  /** Folded search haystack: localized + English name, code, aliases. */
  terms: string[]
}

/**
 * Every country as a search-ready option, sorted by localized name — the
 * picker's list (docs/00 D31). Names come from ICU (no shipped name table);
 * each option carries a folded term list so search works across the viewer's
 * language, English, the code, and common aliases.
 */
export function countryOptions(locale: string): CountryOption[] {
  let display: Intl.DisplayNames | null
  let displayEN: Intl.DisplayNames | null
  try {
    display = new Intl.DisplayNames([locale], { type: 'region' })
  } catch {
    display = null
  }
  try {
    displayEN = new Intl.DisplayNames(['en'], { type: 'region' })
  } catch {
    displayEN = null
  }
  return CODES.map((code) => {
    const name = display?.of(code) ?? code
    const en = displayEN?.of(code) ?? code
    const terms = [
      fold(name),
      fold(en),
      code.toLowerCase(),
      ...(COUNTRY_ALIASES[code] ?? []).map(fold),
    ]
    return { code, name, en, flag: countryFlag(code), terms }
  }).sort((a, b) => a.name.localeCompare(b.name, locale))
}

/**
 * Filter options by a free-text query against the folded haystack (localized
 * name, English name, code, aliases). Empty query returns all; the incoming
 * (localized-name) sort order is preserved.
 */
export function filterCountries(query: string, options: CountryOption[]): CountryOption[] {
  const q = fold(query)
  if (!q) return options
  return options.filter((o) => o.terms.some((term) => term.includes(q)))
}
