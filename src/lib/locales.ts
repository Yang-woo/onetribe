// Locale set — docs/00 D9 P5 (matches the hero copy set in docs/08 B).
// Ordered by region — English, Europe, Southeast Asia, then East Asia (zh/ja/ko).
// This array is the single source of order for the header switcher and the
// stacked policy/About language lists: reorder here and every list follows.
// zh = Simplified (Mainland); zh-Hant = Traditional (Taiwan/Hong Kong).
export const LOCALES = [
  'en',
  'nl',
  'de',
  'es',
  'fr',
  'it',
  'pt',
  'pl',
  'sv',
  'tr',
  'id',
  'th',
  'vi',
  'zh',
  'zh-Hant',
  'ja',
  'ko',
] as const
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
  pl: 'Polski',
  sv: 'Svenska',
  tr: 'Türkçe',
  id: 'Bahasa Indonesia',
  th: 'ไทย',
  vi: 'Tiếng Việt',
  zh: '简体中文',
  'zh-Hant': '繁體中文',
  ja: '日本語',
  ko: '한국어',
}
