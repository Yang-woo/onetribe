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
        disallow: ['/api/', ...LOCALES.map((locale) => `/${locale}/admin`)],
      },
    ],
    sitemap: `${siteUrl()}/sitemap.xml`,
  }
}
