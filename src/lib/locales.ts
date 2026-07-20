// Locale set — docs/00 D9 P5 (matches the hero copy set in docs/08 B).
export const LOCALES = ['en', 'nl', 'de', 'es', 'fr', 'it', 'pt', 'ja', 'ko'] as const
export type Locale = (typeof LOCALES)[number]
export const DEFAULT_LOCALE: Locale = 'en'

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value)
}

// Endonyms — each language's own name, for the multilingual policy pages
// (docs/00 D18). Used as the section label in the stacked "manual" layout.
export const LOCALE_NAMES: Record<Locale, string> = {
  en: 'English',
  nl: 'Nederlands',
  de: 'Deutsch',
  es: 'Español',
  fr: 'Français',
  it: 'Italiano',
  pt: 'Português',
  ja: '日本語',
  ko: '한국어',
}
