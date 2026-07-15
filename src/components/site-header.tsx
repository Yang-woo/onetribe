import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { LocaleSwitcher } from './locale-switcher'

export async function SiteHeader() {
  const t = await getTranslations('hero')
  const tp = await getTranslations('passport')
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-black/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
        <Link href="/" className="font-display text-lg lowercase tracking-tight">
          one <span className="text-orange">tribe</span>
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
