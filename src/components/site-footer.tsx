import Link from 'next/link'
import { copy } from '@/lib/copy'

// The disclaimer is a legal guardrail (docs/05) — it renders on every page.
export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-line px-4 py-8 text-sm text-muted">
      <div className="mx-auto flex max-w-6xl flex-col gap-3">
        <p>{copy.footer.disclaimer}</p>
        <nav className="flex flex-wrap gap-4">
          {copy.footer.links.map((link) => (
            <Link key={link.href} href={link.href} className="hover:text-paper">
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  )
}
