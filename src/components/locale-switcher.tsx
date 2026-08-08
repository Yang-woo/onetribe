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
  zh: '简体中文',
  'zh-Hant': '繁體中文',
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
      onChange={(e) => {
        // Preserve the current query (e.g. a shared ?e=2026 filter) across a
        // language switch — usePathname drops it. window.location is safe here:
        // onChange only fires client-side, so no useSearchParams CSR bailout.
        const search = typeof window !== 'undefined' ? window.location.search : ''
        router.replace(`${pathname}${search}`, { locale: e.target.value as Locale })
      }}
      // Width comes from the widest option, and several are native names
      // (简体中文 / 한국어), so this is the header's second-widest item. Smaller
      // type on phones buys ~16px without truncating anyone's own language.
      className="rounded-full border border-line bg-black px-1 py-1 text-xs text-muted sm:px-2 sm:text-sm"
    >
      {LOCALES.map((code) => (
        <option key={code} value={code}>
          {LOCALE_LABELS[code]}
        </option>
      ))}
    </select>
  )
}
