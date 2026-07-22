import type { Metadata } from 'next'
import { MultilingualArticle, type LocalizedContent } from '@/components/multilingual-article'
import { ABOUT_SUPPORT } from '@/lib/policy-content'
import { ABOUT_I18N } from '@/lib/policy-content-i18n'
import { SUPPORT_LINKS, hasSupportLinks } from '@/lib/support'
import { isLocale, LOCALES, type Locale } from '@/lib/locales'
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
  return { title: ABOUT_I18N[locale].title, alternates: localeAlternates('/about', locale) }
}

const supportButtonClass =
  'rounded-full border border-line px-5 py-2 text-sm font-medium text-paper transition-colors hover:border-orange hover:text-orange'

export default function AboutPage() {
  // Every language stacked (docs/00 D18); the support CTA renders once below.
  const byLocale = Object.fromEntries(
    LOCALES.map((locale) => [
      locale,
      {
        title: ABOUT_I18N[locale].title,
        sections: [{ paragraphs: ABOUT_I18N[locale].paragraphs }],
      },
    ]),
  ) as Record<Locale, LocalizedContent>

  return (
    <MultilingualArticle heading={ABOUT_I18N.en.title} byLocale={byLocale}>
      {hasSupportLinks() && (
        <section id="support" className="mt-12 scroll-mt-16 border-t border-line pt-8">
          <h2 className="mb-4 font-display text-2xl lowercase tracking-tight">
            {ABOUT_SUPPORT.title}
          </h2>
          <p className="text-paper/90">{ABOUT_SUPPORT.body}</p>
          <div className="mt-5 flex flex-wrap gap-3">
            {SUPPORT_LINKS.kofi && (
              <a
                href={SUPPORT_LINKS.kofi}
                target="_blank"
                rel="noopener noreferrer"
                className={supportButtonClass}
              >
                ko-fi ↗
              </a>
            )}
            {SUPPORT_LINKS.githubSponsors && (
              <a
                href={SUPPORT_LINKS.githubSponsors}
                target="_blank"
                rel="noopener noreferrer"
                className={supportButtonClass}
              >
                github sponsors ↗
              </a>
            )}
          </div>
        </section>
      )}
    </MultilingualArticle>
  )
}
