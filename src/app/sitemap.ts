import type { MetadataRoute } from 'next'
import { isLocale, LOCALES } from '@/lib/locales'
import { sitemapEntries } from '@/lib/seo'
import { supabaseServerAnon } from '@/lib/supabase/server-anon'

/**
 * Discovery for /m/[id] (docs/00 D23): the wall is a newest-first stream,
 * so older moments drift out of internal-link reach — the sitemap keeps
 * every public moment one hop away. ANON client: RLS hides hidden rows.
 *
 * One file per locale at /sitemap/{locale}.xml (docs/00 D60). /sitemap.xml
 * answers with the index over them: app/sitemap-index.xml/route.ts, rewritten
 * in by the middleware, because this file still claims /sitemap.xml at build.
 */
export const revalidate = 3600

export async function generateSitemaps() {
  return LOCALES.map((locale) => ({ id: locale }))
}

export default async function sitemap({
  id,
}: {
  id: Promise<string>
}): Promise<MetadataRoute.Sitemap> {
  const locale = await id
  // Only the ids above are generated, but a request can name any — an unknown
  // one gets an empty file, never another locale's URLs.
  if (!isLocale(locale)) return []

  // Soft-fail to the static entries: build environments without Supabase
  // env (CI) prerender pages-only, and a DB hiccup must degrade the
  // sitemap, not 500 it — the hourly revalidate fills moments back in.
  let moments: { id: string; created_at: string }[] = []
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    try {
      const { data } = await supabaseServerAnon()
        .from('memories')
        .select('id, created_at')
        .order('created_at', { ascending: false })
        .limit(5000)
      moments = data ?? []
    } catch {
      // fall through with the static entries
    }
  }
  return sitemapEntries(moments, locale)
}
