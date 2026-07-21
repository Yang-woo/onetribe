'use client'

import { useLocale } from 'next-intl'
import { usePathname, useRouter } from '@/i18n/navigation'
import { LOCALES, type Locale } from '@/lib/locales'

const LOCALE_LABELS: Record<Locale, string> = {
  en: 'EN',
  nl: 'NL',
  de: 'DE',
  es: 'ES',
  fr: 'FR',
  it: 'IT',
  pt: 'PT',
  pl: 'PL',
  sv: 'SV',
  tr: 'TR',
  id: 'ID',
  th: 'ไทย',
  vi: 'VI',
  zh: '中文',
  ja: '日本語',
  ko: '한국어',
}

/**
 * Header language switcher (docs/15). Navigating with an explicit locale
 * makes next-intl persist the choice in the NEXT_LOCALE cookie — the
 * user override beats Accept-Language from then on (docs/04).
 */
export function LocaleSwitcher() {
  const locale = useLocale()
  const router = useRouter()
  const pathname = usePathname()

  return (
    <select
      aria-label="language"
      value={locale}
      onChange={(e) => router.replace(pathname, { locale: e.target.value as Locale })}
      className="rounded-full border border-line bg-black px-2 py-1 text-sm text-muted"
    >
      {LOCALES.map((code) => (
        <option key={code} value={code}>
          {LOCALE_LABELS[code]}
        </option>
      ))}
    </select>
  )
}
