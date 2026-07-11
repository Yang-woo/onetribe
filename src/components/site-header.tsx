import Link from 'next/link'
import { copy } from '@/lib/copy'

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-black/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <Link href="/" className="font-display text-lg lowercase tracking-tight">
          one <span className="text-orange">tribe</span>
        </Link>
        <Link
          href="/upload"
          className="rounded-full bg-orange px-4 py-2 text-sm font-medium text-black transition-opacity hover:opacity-90"
        >
          {copy.hero.cta}
        </Link>
      </div>
    </header>
  )
}
