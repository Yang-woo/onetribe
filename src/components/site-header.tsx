import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { LocaleSwitcher } from './locale-switcher'
import { LogoMark } from './logo'

export async function SiteHeader() {
  const t = await getTranslations('hero')
  const tp = await getTranslations('passport')
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-black/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-2 py-3 sm:gap-3 sm:px-4">
        {/* Horizontal lockup — the handoff's vertical primary doesn't fit a
            48px header; beam mark ≥16px min-size, wordmark per spec
            (Space Grotesk 700, .18em tracking, uppercase). */}
        <Link href="/" className="flex items-center gap-2.5">
          <LogoMark className="h-5 w-[30px]" />
          {/* Symbol alone below sm — the four items do not fit a 360px phone
              together, and docs/12 sanctions the mark on its own down to 16px
              (full lockup 24px).
              `sr-only`, not `hidden`: the mark is aria-hidden, so this text is
              the home link's only accessible name and `display:none` would
              leave the link nameless on every phone (WCAG 2.4.4). sr-only is
              out of flow, so it still costs the row nothing. */}
          <span className="sr-only font-display text-sm font-bold tracking-[0.18em] text-paper sm:not-sr-only">
            ONE TRIBE
          </span>
        </Link>
        <div className="flex items-center gap-1.5 sm:gap-3">
          <Link
            href="/passport"
            className="whitespace-nowrap text-[13px] lowercase text-muted transition-colors hover:text-paper sm:text-sm"
          >
            {tp('nav')}
          </Link>
          <LocaleSwitcher />
          {/* The header's width budget is really seventeen budgets: this label
              runs 83px (tr) to 191px (vi) while most locales have ~50px to
              spare, so tuning the row against English left Portuguese,
              Italian and Vietnamese overflowing. A phone gets the verb alone,
              which is a substring of the full label — so the accessible name
              below still contains what is on screen (WCAG 2.5.3). */}
          <Link
            href="/upload"
            aria-label={t('cta')}
            className="whitespace-nowrap rounded-full bg-orange px-3 py-2 text-[13px] font-medium text-black transition-opacity hover:opacity-90 sm:px-4 sm:text-sm"
          >
            <span className="sm:hidden">{t('ctaShort')}</span>
            <span className="hidden sm:inline">{t('cta')}</span>
          </Link>
        </div>
      </div>
    </header>
  )
}
