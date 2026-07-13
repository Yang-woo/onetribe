import { screen } from '@testing-library/react'
import { renderWithIntl } from '@/test-utils'
import { describe, expect, test } from 'vitest'
import type { EditionChip } from '@/lib/moments'
import { EditionChips } from './edition-chips'

// Spec: docs/15 §1 — edition chips filter the wall via URL params; the
// canceled 2026 edition carries the "lost weekend" label.

const editions: EditionChip[] = [
  { id: 'e2026', year: 2026, edition: null, canceled: true },
  { id: 'e2025', year: 2025, edition: null, canceled: false },
  { id: 'e2019', year: 2019, edition: 'One Tribe', canceled: false },
]

describe('EditionChips', () => {
  test('renders an "all" chip plus one chip per edition, locale-prefixed links (T3.1)', () => {
    renderWithIntl(<EditionChips editions={editions} selectedYear={null} />)
    expect(screen.getByRole('link', { name: 'all' })).toHaveAttribute('href', '/en')
    expect(screen.getByRole('link', { name: '2025' })).toHaveAttribute('href', '/en?e=2025')
    expect(screen.getByRole('link', { name: '2019' })).toHaveAttribute('href', '/en?e=2019')
  })

  test('2026 gets the lost-weekend label (launch hook)', () => {
    renderWithIntl(<EditionChips editions={editions} selectedYear={null} />)
    expect(
      screen.getByRole('link', { name: '2026 — the weekend that never happened' }),
    ).toBeInTheDocument()
  })

  test('the selected year is marked as current', () => {
    renderWithIntl(<EditionChips editions={editions} selectedYear={2025} />)
    expect(screen.getByRole('link', { name: '2025' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: '2019' })).not.toHaveAttribute('aria-current')
  })
})
