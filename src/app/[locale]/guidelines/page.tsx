import type { Metadata } from 'next'
import { PolicyArticle } from '@/components/policy-article'
import { isLocale } from '@/lib/locales'
import { POLICIES } from '@/lib/policy-content'
import { POLICY_I18N } from '@/lib/policy-content-i18n'
import { localeAlternates } from '@/lib/seo'

export const dynamic = 'force-dynamic'

// Reviewed per-locale title (docs/00 D18/D19) + the hreflang cluster the
// policy pages were missing (docs/00 D23, docs/07 backlog item).
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  if (!isLocale(locale)) return {}
  return {
    title: POLICY_I18N[locale].guidelines.title,
    alternates: localeAlternates('/guidelines', locale),
  }
}

export default function Page() {
  return <PolicyArticle doc={POLICIES.guidelines} />
}
