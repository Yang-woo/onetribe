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
 * One locale's sitemap file (docs/00 D60). Google wants a separate <url> for
 * every URL — an hreflang alternate alone does not list a page — so each
 * language version is its own entry, still carrying the whole cluster
 * including itself. It used to be /en entries only, which left the other 16
 * locales (every /ko page included) listed nowhere but as alternates.
 *
 * Split by locale rather than one big file: seventeen URLs per moment would
 * push a single sitemap past its 50 MB limit around 1,300 moments, and a
 * locale file lets Naver be given /ko on its own.
 */
export function sitemapEntries(
  moments: { id: string; created_at: string }[],
  locale: Locale,
): MetadataRoute.Sitemap {
  return [
    ...SITEMAP_PATHS.map((path) => ({
      url: localeUrl(locale, path),
      alternates: { languages: languageUrls(path) },
      changeFrequency: path === '/' ? ('daily' as const) : ('monthly' as const),
      priority: path === '/' ? 1 : 0.5,
    })),
    ...moments.map((moment) => ({
      url: localeUrl(locale, `/m/${moment.id}`),
      lastModified: new Date(moment.created_at),
      alternates: { languages: languageUrls(`/m/${moment.id}`) },
    })),
  ]
}

/**
 * /sitemap.xml as an index over the locale files — the URL GSC and Bing were
 * given in D23 stays valid, and robots.txt keeps pointing at it.
 */
export function sitemapIndexXml(): string {
  const files = LOCALES.map(
    (locale) => `<sitemap><loc>${siteUrl()}/sitemap/${locale}.xml</loc></sitemap>`,
  )
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...files,
    '</sitemapindex>',
    '',
  ].join('\n')
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

function websiteId(): string {
  return `${siteUrl()}/#website`
}

/**
 * The home page's <title>. It was the bare name, and the name alone does not
 * say which "one tribe" this is — it is also Q-dance's brand language and the
 * 2019 anthem title (docs/00 D2). The GSC baseline showed it: every query that
 * reached this site was a name collision and not one contained "defqon"
 * (docs/00 D60). "fan" carries the unaffiliated framing the title needs, and
 * it is the only unaffiliated signal a search result gets — the description
 * reuses the hero body, which carries none. Defqon.1 itself is named
 * descriptively, which docs/05 allows (only the logo and symbols are off
 * limits).
 *
 * English in every locale, but only half for the reason the dateline is
 * (docs/00 D25): the name is a fixed brand string, while the tail after it is
 * descriptive copy kept in English to avoid a second unreviewed translation
 * layer (docs/00 D23). Translating it later means moving it to an i18n key.
 */
export const HOME_TITLE = `one tribe — a Defqon.1 fan memory wall in ${LOCALES.length} languages`

/**
 * The site-wide Open Graph card (docs/00 D23), shared rather than written
 * inline in the layout: Next REPLACES the whole `openGraph` object when a page
 * declares one, so a page that needs its own `og:url` would otherwise drop the
 * image, type and site name along with it. `url` is the page's canonical —
 * without it a share of `/{locale}?e=2026` scrapes as its own card instead of
 * the wall's.
 */
export function siteOpenGraph(description: string, url?: string) {
  return {
    siteName: 'one tribe',
    type: 'website' as const,
    title: 'one tribe',
    description,
    ...(url ? { url } : {}),
    images: [{ url: `${siteUrl()}/api/og/site`, width: 1200, height: 630 }],
  }
}

/**
 * The project as one entity (GEO/LLMO): "one tribe" is also Q-dance's brand
 * language (docs/00 D2), so the name alone can't tell models which one this
 * is — sameAs ties every surface we run to this domain. Plain Organization,
 * not NGO: a fan project isn't a registered non-profit, and the data must not
 * claim more than the site does.
 */
function organizationJsonLd(): object {
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

// Not exported: without the graph's @context this node is not valid on its own.
function websiteJsonLd(description: string): object {
  return {
    '@type': 'WebSite',
    '@id': websiteId(),
    name: 'one tribe',
    url: siteUrl(),
    description,
    inLanguage: [...LOCALES],
    // by reference — a second inline Organization would split the entity
    publisher: { '@id': organizationId() },
  }
}

/**
 * The about page as a node of the same graph (GEO/LLMO): it is the only page
 * that says who runs this and why, and answer engines weigh "who is speaking"
 * — but it carried no structured data at all, so nothing tied it to the
 * organization declared on the home page. By @id again, never a second inline
 * Organization. `name` is the heading the page actually shows, per locale.
 */
export function aboutPageJsonLd(locale: Locale, name: string): object {
  const url = localeUrl(locale, '/about')
  return {
    '@context': 'https://schema.org',
    '@type': 'AboutPage',
    '@id': `${url}#webpage`,
    url,
    name,
    inLanguage: locale,
    isPartOf: { '@id': websiteId() },
    mainEntity: { '@id': organizationId() },
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
 *
 * The edition line and city arrive already computed: this module is imported
 * by the middleware, so it must not pull the moments module (and Supabase with
 * it) into the edge bundle. Both are facts the page already prints — the line
 * is its h1 (docs/00 D59) — so nothing here is a claim the screen doesn't make.
 */
export function momentJsonLd(
  moment: {
    id: string
    media_kind: 'image' | 'gif' | 'clip'
    media_url: string | null
    thumb_url?: string | null
    caption: string | null
    author_name: string | null
    author_link: string | null
    created_at: string
  },
  locale: Locale,
  event: { line?: string | null; city?: string | null } = {},
): object | null {
  if (moment.media_kind === 'clip' || !moment.media_url) return null
  return {
    '@context': 'https://schema.org',
    '@type': 'ImageObject',
    ...(event.line ? { name: event.line } : {}),
    contentUrl: moment.media_url,
    ...(moment.thumb_url ? { thumbnailUrl: moment.thumb_url } : {}),
    ...(moment.caption ? { caption: moment.caption } : {}),
    // uploadDate, not dateCreated: created_at is when this wall received the
    // moment, and most moments are old photos — dateCreated would date a 2013
    // edition's picture to the day someone finally posted it.
    uploadDate: moment.created_at,
    ...(event.city ? { contentLocation: { '@type': 'Place', name: event.city } } : {}),
    ...(moment.author_name
      ? {
          author: {
            '@type': 'Person',
            name: moment.author_name,
            ...(moment.author_link ? { url: moment.author_link } : {}),
          },
        }
      : {}),
    // The moment page carried no link back to the entity that publishes it —
    // by @id, so the organization stays declared exactly once (home page).
    isPartOf: { '@id': websiteId() },
    publisher: { '@id': organizationId() },
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
