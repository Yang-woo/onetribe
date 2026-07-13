import { defineRouting } from 'next-intl/routing'
import { DEFAULT_LOCALE, LOCALES } from '@/lib/locales'

// Every page lives under /[locale]/… (docs/15). next-intl's middleware
// negotiates Accept-Language on first visit and remembers the user's
// override in the NEXT_LOCALE cookie (docs/04).
export const routing = defineRouting({
  locales: LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  localePrefix: 'always',
})
