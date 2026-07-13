import { LOCALES } from '@/lib/locales'
import { siteUrl } from '@/lib/site-url'

/**
 * hreflang alternates per page — the SEO core of the whole project
 * (docs/04): one memory indexed once per language.
 */
export function localeAlternates(path: string): {
  languages: Record<string, string>
} {
  const base = siteUrl()
  const suffix = path === '/' ? '' : path
  return {
    languages: {
      ...Object.fromEntries(LOCALES.map((locale) => [locale, `${base}/${locale}${suffix}`])),
      'x-default': `${base}/en${suffix}`,
    },
  }
}
