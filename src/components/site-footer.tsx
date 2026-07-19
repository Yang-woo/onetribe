import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { hasSupportLinks } from '@/lib/support'

const FOOTER_LINKS = ['terms', 'privacy', 'takedown', 'guidelines', 'about'] as const

// The disclaimer is a legal guardrail (docs/05) — it renders on every page.
export async function SiteFooter() {
  const t = await getTranslations('footer')
  return (
    <footer className="mt-16 border-t border-line px-4 py-8 text-sm text-muted">
      <div className="mx-auto flex max-w-6xl flex-col gap-3">
        <p>{t('disclaimer')}</p>
        <nav className="flex flex-wrap gap-4">
          {FOOTER_LINKS.map((key) => (
            <Link key={key} href={`/${key}`} className="hover:text-paper">
              {t(`links.${key}`)}
            </Link>
          ))}
          {/* Donations enter via About's no-perk framing, never a direct external link (D15). */}
          {hasSupportLinks() && (
            <Link href="/about#support" className="hover:text-paper">
              {t('links.support')}
            </Link>
          )}
        </nav>
      </div>
    </footer>
  )
}
