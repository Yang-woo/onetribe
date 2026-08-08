import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { SITE_LINKS } from '@/lib/site-links'
import { hasSupportLinks, SUPPORT_ANCHOR } from '@/lib/support'

// The disclaimer is a legal guardrail (docs/05) — it renders on every page.
export async function SiteFooter() {
  const t = await getTranslations('footer')
  return (
    // The wall page adds bottom room here so its floating info button doesn't
    // land on these links — see globals.css. Static room beats hiding the
    // button on scroll: no observer, no state, no timing to get wrong.
    <footer className="mt-16 border-t border-line px-4 py-8 text-sm text-muted">
      <div className="mx-auto flex max-w-6xl flex-col gap-3">
        <p>{t('disclaimer')}</p>
        <nav className="flex flex-wrap gap-4">
          {SITE_LINKS.map((key) => (
            <Link key={key} href={`/${key}`} className="hover:text-paper">
              {t(`links.${key}`)}
            </Link>
          ))}
          {/* Donations enter via About's no-perk framing, never a direct external link (D15). */}
          {hasSupportLinks() && (
            <Link href={SUPPORT_ANCHOR} className="hover:text-paper">
              {t('links.support')}
            </Link>
          )}
        </nav>
      </div>
    </footer>
  )
}
