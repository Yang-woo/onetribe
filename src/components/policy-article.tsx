import { MultilingualArticle } from './multilingual-article'
import { POLICY_LAST_UPDATED, type PolicyDoc } from '@/lib/policy-content'
import { POLICY_I18N } from '@/lib/policy-content-i18n'
import { LOCALES, type Locale } from '@/lib/locales'

/**
 * Policy renderer — every language stacked (docs/00 D18). EN is the binding
 * text; non-EN are reviewed DeepL translations. Same output for every URL
 * locale. (Superseded the earlier EN-only + per-locale notice-banner design.)
 */
export function PolicyArticle({ doc }: { doc: PolicyDoc }) {
  const byLocale = Object.fromEntries(
    LOCALES.map((locale) => [locale, POLICY_I18N[locale][doc.slug]]),
  ) as Record<Locale, (typeof POLICY_I18N)[Locale][PolicyDoc['slug']]>

  return (
    <MultilingualArticle
      heading={doc.title}
      lastUpdated={POLICY_LAST_UPDATED}
      byLocale={byLocale}
    />
  )
}
