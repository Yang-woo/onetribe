import { getLocale, getTranslations } from 'next-intl/server'
import type { PolicyDoc } from '@/lib/policy-content'

/**
 * Policy renderer — EN is the binding text (docs/10 checklist); non-EN
 * locales get a notice banner instead of machine-translated legalese.
 */
export async function PolicyArticle({ doc }: { doc: PolicyDoc }) {
  const locale = await getLocale()
  const t = await getTranslations('policies')

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-10">
      <h1 className="mb-2 font-display text-3xl tracking-tight">{doc.title}</h1>
      <p className="mb-6 text-sm text-muted">One Tribe (onetribe.dance) — last updated: [DATE]</p>
      {locale !== 'en' && (
        <p className="mb-6 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-muted">
          {t('enNotice')}
        </p>
      )}
      <div className="flex flex-col gap-5">
        {doc.sections.map((section, index) => (
          <section key={section.heading ?? index} className="flex flex-col gap-2">
            {section.heading && <h2 className="font-medium text-paper">{section.heading}</h2>}
            {section.paragraphs.map((paragraph) => (
              <p key={paragraph.slice(0, 32)} className="text-sm leading-relaxed text-paper/85">
                {paragraph}
              </p>
            ))}
          </section>
        ))}
      </div>
    </main>
  )
}
