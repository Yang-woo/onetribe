import { franc } from 'franc-min'
import { isLocale, type Locale } from '@/lib/locales'

/**
 * Caption language guess at write time (docs/04). Best effort by design:
 * short or ambiguous captions stay null and DeepL's detection corrects
 * source_lang later, on first translation.
 */

const ISO639_3_TO_LOCALE: Record<string, Locale> = {
  eng: 'en',
  nld: 'nl',
  deu: 'de',
  spa: 'es',
  fra: 'fr',
  ita: 'it',
  por: 'pt',
  jpn: 'ja',
  kor: 'ko',
  pol: 'pl',
  swe: 'sv',
  tur: 'tr',
  cmn: 'zh',
  ind: 'id',
  tha: 'th',
  vie: 'vi',
}

export function detectCaptionLocale(caption: string | null | undefined): Locale | null {
  const text = caption?.trim()
  if (!text || text.length < 10) return null
  const iso = franc(text, { minLength: 10 })
  const locale = ISO639_3_TO_LOCALE[iso]
  if (locale) return locale
  // franc-min may land on a sibling language outside our set — stay null
  // rather than storing a locale we can't serve.
  return isLocale(iso) ? (iso as Locale) : null
}
