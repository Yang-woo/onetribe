import type { MetadataRoute } from 'next'
import { LOCALES } from '@/lib/locales'
import { siteUrl } from '@/lib/site-url'

/**
 * Crawl hygiene (docs/00 D23): APIs and the admin console are not for
 * crawlers; everything else — AI crawlers included (GEO) — is welcome.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        // OG image endpoints must stay crawlable — they're the share-card
        // source. `allow` is more specific than the `/api/` disallow, so
        // standards-respecting crawlers (Google, Bing, Twitterbot) still fetch
        // them while the rest of /api stays off-limits.
        allow: ['/api/og/'],
        disallow: ['/api/', ...LOCALES.map((locale) => `/${locale}/admin`)],
      },
    ],
    sitemap: `${siteUrl()}/sitemap.xml`,
  }
}
