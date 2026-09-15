import { sitemapIndexXml } from '@/lib/seo'

/**
 * The index over the per-locale sitemaps (docs/00 D60), served to crawlers at
 * /sitemap.xml — the URL submitted to GSC and Bing (D23) and the one robots.txt
 * names. It cannot live at that path itself: app/sitemap.ts claims /sitemap.xml
 * even with generateSitemaps, and a route beside it fails the build. The
 * middleware rewrites /sitemap.xml here.
 */
export const revalidate = 3600

export function GET(): Response {
  return new Response(sitemapIndexXml(), {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  })
}
