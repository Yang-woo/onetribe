import { LOCALES } from '@/lib/locales'

/**
 * hreflang alternates per page — the SEO core of the whole project
 * (docs/04): one memory indexed once per language.
 */
export function localeAlternates(path: string): {
  languages: Record<string, string>
} {
  const base = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '')
  const suffix = path === '/' ? '' : path
  return {
    languages: {
      ...Object.fromEntries(LOCALES.map((locale) => [locale, `${base}/${locale}${suffix}`])),
      'x-default': `${base}/en${suffix}`,
    },
  }
}
