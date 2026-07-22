import type { MetadataRoute } from 'next'
import { sitemapEntries } from '@/lib/seo'
import { supabaseServerAnon } from '@/lib/supabase/server-anon'

/**
 * Discovery for /m/[id] (docs/00 D23): the wall is a newest-first stream,
 * so older moments drift out of internal-link reach — the sitemap keeps
 * every public moment one hop away. ANON client: RLS hides hidden rows.
 */
export const revalidate = 3600

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { data } = await supabaseServerAnon()
    .from('memories')
    .select('id, created_at')
    .order('created_at', { ascending: false })
    .limit(5000)
  return sitemapEntries(data ?? [])
}
