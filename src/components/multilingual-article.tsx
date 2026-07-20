import type { ReactNode } from 'react'
import { LOCALES, LOCALE_NAMES, type Locale } from '@/lib/locales'

export interface LocalizedContent {
  title: string
  sections: { heading?: string; paragraphs: string[] }[]
}

/**
 * Renders one document in every language at once, stacked like a multilingual
 * product manual (docs/00 D18). English is the binding original and comes
 * first; the rest are DeepL machine translations (reviewed once). The page is
 * identical regardless of the URL locale — a /ko and /en visitor see the same
 * all-languages page. `children` renders once after the stack (e.g. the About
 * support CTA).
 */
export function MultilingualArticle({
  heading,
  lastUpdated,
  byLocale,
  children,
}: {
  heading: string
  lastUpdated?: string
  byLocale: Record<Locale, LocalizedContent>
  children?: ReactNode
}) {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-10">
      <h1 className="mb-2 font-display text-3xl tracking-tight">{heading}</h1>
      {lastUpdated && <p className="mb-4 text-sm text-muted">last updated: {lastUpdated}</p>}
      <p className="mb-6 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-muted">
        English is the binding version. The other languages are machine-assisted translations for
        convenience — if anything differs, the English text prevails.
      </p>
      <nav aria-label="Languages" className="mb-10 flex flex-wrap gap-x-3 gap-y-1 text-sm">
        {LOCALES.map((locale) => (
          <a key={locale} href={`#lang-${locale}`} className="text-muted hover:text-orange">
            {LOCALE_NAMES[locale]}
          </a>
        ))}
      </nav>
      <div className="flex flex-col gap-12">
        {LOCALES.map((locale) => {
          const doc = byLocale[locale]
          return (
            <article
              key={locale}
              id={`lang-${locale}`}
              lang={locale}
              className="scroll-mt-16 border-t border-line pt-6"
            >
              <p className="mb-3 text-xs uppercase tracking-wide text-muted">
                {LOCALE_NAMES[locale]}
              </p>
              <h2 className="mb-4 font-display text-2xl tracking-tight">{doc.title}</h2>
              <div className="flex flex-col gap-5">
                {doc.sections.map((section, index) => (
                  <section key={section.heading ?? index} className="flex flex-col gap-2">
                    {section.heading && (
                      <h3 className="font-medium text-paper">{section.heading}</h3>
                    )}
                    {section.paragraphs.map((paragraph) => (
                      <p
                        key={paragraph.slice(0, 32)}
                        className="text-sm leading-relaxed text-paper/85"
                      >
                        {paragraph}
                      </p>
                    ))}
                  </section>
                ))}
              </div>
            </article>
          )
        })}
      </div>
      {children}
    </main>
  )
}
