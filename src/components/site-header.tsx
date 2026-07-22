import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { LocaleSwitcher } from './locale-switcher'
import { LogoMark } from './logo'

export async function SiteHeader() {
  const t = await getTranslations('hero')
  const tp = await getTranslations('passport')
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-black/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
        {/* Horizontal lockup — the handoff's vertical primary doesn't fit a
            48px header; beam mark ≥16px min-size, wordmark per spec
            (Space Grotesk 700, .18em tracking, uppercase). */}
        <Link href="/" className="flex items-center gap-2.5">
          <LogoMark className="h-5 w-[30px]" />
          <span className="font-display text-sm font-bold tracking-[0.18em] text-paper">
            ONE TRIBE
          </span>
        </Link>
        <div className="flex items-center gap-2 sm:gap-3">
          <Link
            href="/passport"
            className="whitespace-nowrap text-sm lowercase text-muted transition-colors hover:text-paper"
          >
            {tp('nav')}
          </Link>
          <LocaleSwitcher />
          <Link
            href="/upload"
            className="whitespace-nowrap rounded-full bg-orange px-4 py-2 text-sm font-medium text-black transition-opacity hover:opacity-90"
          >
            {t('cta')}
          </Link>
        </div>
      </div>
    </header>
  )
}
