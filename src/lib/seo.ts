import type { MetadataRoute } from 'next'
import { LOCALES, type Locale } from '@/lib/locales'
import { siteUrl } from '@/lib/site-url'

/**
 * hreflang alternates + self-referencing canonical per page — the SEO core
 * of the whole project (docs/04): one memory indexed once per language.
 * These HTML tags are the single source of hreflang truth; next-intl's
 * host-derived Link headers are disabled (docs/00 D23).
 */
export function localeAlternates(
  path: string,
  locale: Locale,
): { canonical: string; languages: Record<string, string> } {
  return { canonical: localeUrl(locale, path), languages: languageUrls(path) }
}

function localeUrl(locale: string, path: string): string {
  return `${siteUrl()}/${locale}${path === '/' ? '' : path}`
}

function languageUrls(path: string): Record<string, string> {
  return {
    ...Object.fromEntries(LOCALES.map((locale) => [locale, localeUrl(locale, path)])),
    'x-default': localeUrl('en', path),
  }
}

/**
 * 308 target when a request arrives on a non-canonical host — www and the
 * *.vercel.app production alias served identical content with no canonical
 * signal (docs/00 D23). Only acts in production with an explicit
 * NEXT_PUBLIC_SITE_URL, so previews and local dev keep their hosts.
 */
export function canonicalHostRedirect(
  requestUrl: URL,
  {
    base = process.env.NEXT_PUBLIC_SITE_URL,
    vercelEnv = process.env.VERCEL_ENV,
  }: { base?: string; vercelEnv?: string } = {},
): URL | null {
  if (vercelEnv !== 'production' || !base) return null
  const canonical = new URL(base)
  if (requestUrl.host === canonical.host) return null
  const target = new URL(requestUrl.href)
  target.protocol = canonical.protocol
  target.host = canonical.host
  return target
}

// Publicly indexable static routes — admin is noindexed, api is disallowed.
const SITEMAP_PATHS = [
  '/',
  '/about',
  '/guidelines',
  '/privacy',
  '/terms',
  '/takedown',
  '/upload',
  '/passport',
] as const

/**
 * One entry per path (the x-default /en URL) carrying all language
 * alternates — the full hreflang cluster without 17× the URL count.
 */
export function sitemapEntries(
  moments: { id: string; created_at: string }[],
): MetadataRoute.Sitemap {
  return [
    ...SITEMAP_PATHS.map((path) => ({
      url: localeUrl('en', path),
      alternates: { languages: languageUrls(path) },
      changeFrequency: path === '/' ? ('daily' as const) : ('monthly' as const),
      priority: path === '/' ? 1 : 0.5,
    })),
    ...moments.map((moment) => ({
      url: localeUrl('en', `/m/${moment.id}`),
      lastModified: new Date(moment.created_at),
      alternates: { languages: languageUrls(`/m/${moment.id}`) },
    })),
  ]
}

/** schema.org JSON-LD serialized with `<` escaped, so it is </script>-safe. */
export function serializeJsonLd(data: object): string {
  return JSON.stringify(data).replace(/</g, '\\u003c')
}

export function websiteJsonLd(description: string): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'one tribe',
    url: siteUrl(),
    description,
    inLanguage: [...LOCALES],
  }
}

/**
 * ImageObject for a photo/GIF moment — author, date and canonical page in
 * machine-readable form (image search + GEO). Clips and media-less rows
 * yield nothing: the schema would claim an image we don't host.
 */
export function momentJsonLd(
  moment: {
    id: string
    media_kind: 'image' | 'gif' | 'clip'
    media_url: string | null
    caption: string | null
    author_name: string | null
    author_link: string | null
    created_at: string
  },
  locale: Locale,
): object | null {
  if (moment.media_kind === 'clip' || !moment.media_url) return null
  return {
    '@context': 'https://schema.org',
    '@type': 'ImageObject',
    contentUrl: moment.media_url,
    ...(moment.caption ? { caption: moment.caption } : {}),
    dateCreated: moment.created_at,
    ...(moment.author_name
      ? {
          author: {
            '@type': 'Person',
            name: moment.author_name,
            ...(moment.author_link ? { url: moment.author_link } : {}),
          },
        }
      : {}),
    mainEntityOfPage: localeUrl(locale, `/m/${moment.id}`),
  }
}
