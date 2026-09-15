import type { MetadataRoute } from 'next'
import { countryName } from '@/lib/country'
import { instagramHandle } from '@/lib/format'
import { LOCALES, type Locale } from '@/lib/locales'
import { POLICY_CONTACT_EMAIL } from '@/lib/policy-content'
import { SOURCE_LINK } from '@/lib/site-links'
import { siteUrl } from '@/lib/site-url'
import { SUPPORT_LINKS } from '@/lib/support'

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

/**
 * Profiles the project itself owns (docs/00 D28) — IG/Threads carry the
 * underscore variant because `onetribeworld` was taken there. YouTube is
 * held, not run, but it is still ours. Ko-fi and the source repo join from
 * their own constants so a switched-off rail drops out of the claim too.
 */
const OWNED_PROFILES = [
  'https://www.instagram.com/onetribe_world/',
  'https://www.threads.com/@onetribe_world',
  'https://www.youtube.com/@onetribeworld',
] as const

function organizationId(): string {
  return `${siteUrl()}/#organization`
}

/**
 * The project as one entity (GEO/LLMO): "one tribe" is also Q-dance's brand
 * language (docs/00 D2), so the name alone can't tell models which one this
 * is — sameAs ties every surface we run to this domain. Plain Organization,
 * not NGO: a fan project isn't a registered non-profit, and the data must not
 * claim more than the site does.
 */
export function organizationJsonLd(): object {
  return {
    '@type': 'Organization',
    '@id': organizationId(),
    name: 'one tribe',
    url: siteUrl(),
    logo: `${siteUrl()}/icon-512.png`,
    email: POLICY_CONTACT_EMAIL,
    sameAs: [...OWNED_PROFILES, SOURCE_LINK.url, SUPPORT_LINKS.kofi].filter(Boolean),
  }
}

export function websiteJsonLd(description: string): object {
  return {
    '@type': 'WebSite',
    '@id': `${siteUrl()}/#website`,
    name: 'one tribe',
    url: siteUrl(),
    description,
    inLanguage: [...LOCALES],
    // by reference — a second inline Organization would split the entity
    publisher: { '@id': organizationId() },
  }
}

/** Home page graph: the organization declared once, the website pointing at it. */
export function siteJsonLd(description: string): object {
  return {
    '@context': 'https://schema.org',
    '@graph': [organizationJsonLd(), websiteJsonLd(description)],
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

/**
 * Meta description for a moment page, built only from what that page shows:
 * caption, edition line, name, @handle, country — in that order. Most moments
 * have no caption (docs/00 D58: 187 of 222), and with no description a search
 * snippet falls back to the header's language list (docs/00 D59). Joining
 * facts adds no copy to translate; the country is named by Intl in the
 * reader's locale, as the page names it.
 */
export function momentDescription(
  moment: {
    caption: string | null
    author_name: string | null
    author_link: string | null
    origin_country: string | null
  },
  eventLine: string | null | undefined,
  locale: string,
): string | undefined {
  const handle = instagramHandle(moment.author_link)
  const parts = [
    moment.caption,
    eventLine,
    moment.author_name,
    handle && `@${handle}`,
    moment.origin_country && countryName(moment.origin_country, locale),
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : undefined
}
