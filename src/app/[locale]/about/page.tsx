import { ABOUT, ABOUT_SUPPORT } from '@/lib/policy-content'
import { SUPPORT_LINKS, hasSupportLinks } from '@/lib/support'

export const dynamic = 'force-dynamic'

const supportButtonClass =
  'rounded-full border border-line px-5 py-2 text-sm font-medium text-paper transition-colors hover:border-orange hover:text-orange'

export default function AboutPage() {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-10">
      <h1 className="mb-6 font-display text-3xl lowercase tracking-tight">{ABOUT.title}</h1>
      <div className="flex flex-col gap-4 text-paper/90">
        {ABOUT.paragraphs.map((paragraph) => (
          <p key={paragraph.slice(0, 24)}>{paragraph}</p>
        ))}
      </div>
      {hasSupportLinks() && (
        <section id="support" className="mt-10 border-t border-line pt-8">
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
    </main>
  )
}
