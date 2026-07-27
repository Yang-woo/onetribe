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

// The donation rail sat at the bottom of a long page as a faint outline pill and
// read as a footnote (docs/00 D15, 2026-07-28): its border was the same value as
// the body rules around it. Orange outline — not a filled orange pill — because
// filled orange is the site's primary action ("add yours" in the header) and
// donating must not climb to that rank. #ff6a00 on #0b0908 is 6.9:1 (docs/00 D35).
const supportButtonClass =
  'inline-flex items-center gap-2 rounded-full border border-orange px-6 py-3 font-medium text-orange transition-colors hover:bg-orange/10'

/** Secondary rails keep the quieter outline — only Ko-fi carries the mark. */
const supportSecondaryClass =
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
                {/* Ko-fi's own cup mark, unmodified, self-hosted so the page makes
                    no third-party request (their brand page offers it for exactly
                    this: linking to your page). Decorative — alt="" keeps the
                    accessible name to the label alone (docs/00 D35, WCAG 2.5.3).
                    The label stays in our voice: the body says "buy the server a
                    coffee", so the button must not say "buy me a coffee". */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/kofi-cup.png" alt="" width={25} height={20} className="h-5 w-auto" />
                buy the server a coffee ↗
              </a>
            )}
            {SUPPORT_LINKS.githubSponsors && (
              <a
                href={SUPPORT_LINKS.githubSponsors}
                target="_blank"
                rel="noopener noreferrer"
                className={supportSecondaryClass}
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
