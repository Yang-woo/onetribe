import Link from 'next/link'
import { copy } from '@/lib/copy'
import type { EditionChip } from '@/lib/moments'

/**
 * Horizontal edition filter — docs/15 §1. Canceled editions render in
 * Defqon Red (emotion role, docs/12 B); 2026 carries the "lost weekend"
 * label. Filter state lives in the URL (?e=2026) so views are shareable.
 */
export function EditionChips({
  editions,
  selectedYear,
}: {
  editions: EditionChip[]
  selectedYear: number | null
}) {
  const base = 'shrink-0 rounded-full border px-3 py-1 text-sm transition-colors whitespace-nowrap'
  const idle = 'border-line text-muted hover:text-paper'
  const active = 'border-orange text-orange'
  const lost = 'border-red/40 text-red'

  return (
    <nav aria-label="editions" className="flex gap-2 overflow-x-auto px-4 py-3">
      <Link href="/" className={`${base} ${selectedYear === null ? active : idle}`}>
        {copy.wall.allEditions}
      </Link>
      {editions.map((edition) => {
        const isActive = selectedYear === edition.year
        const label =
          edition.year === 2026 ? copy.wall.lostEditionChip(edition.year) : String(edition.year)
        return (
          <Link
            key={edition.id}
            href={`/?e=${edition.year}`}
            aria-current={isActive ? 'page' : undefined}
            className={`${base} ${isActive ? active : edition.canceled ? lost : idle}`}
          >
            {label}
          </Link>
        )
      })}
    </nav>
  )
}
