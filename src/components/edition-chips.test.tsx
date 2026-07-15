import { fireEvent, screen } from '@testing-library/react'
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

  // Desktop mouse: a vertical wheel must scroll the overflowing row sideways
  // (macOS hides the scrollbar and a mouse can't reach it) but yield to the
  // page at the ends. jsdom has no layout, so fake the scroll metrics.
  function fakeScroller(overflow: { scrollWidth: number; clientWidth: number; scrollLeft: number }) {
    const nav = screen.getByRole('navigation', { name: 'editions' })
    let scrollLeft = overflow.scrollLeft
    Object.defineProperty(nav, 'scrollWidth', { value: overflow.scrollWidth, configurable: true })
    Object.defineProperty(nav, 'clientWidth', { value: overflow.clientWidth, configurable: true })
    Object.defineProperty(nav, 'scrollLeft', {
      get: () => scrollLeft,
      set: (v: number) => {
        scrollLeft = v
      },
      configurable: true,
    })
    const wheel = (init: WheelEventInit) => {
      const evt = Object.assign(new Event('wheel', { bubbles: true, cancelable: true }), init)
      const notPrevented = nav.dispatchEvent(evt)
      return { prevented: !notPrevented, scrollLeft: nav.scrollLeft }
    }
    return { nav, wheel }
  }

  test('vertical wheel scrolls the row sideways and suppresses page scroll', () => {
    renderWithIntl(<EditionChips editions={editions} selectedYear={null} />)
    const { wheel } = fakeScroller({ scrollWidth: 500, clientWidth: 200, scrollLeft: 0 })
    const r = wheel({ deltaY: 120, deltaX: 0 })
    expect(r.scrollLeft).toBe(120)
    expect(r.prevented).toBe(true)
  })

  test('at the right edge, the wheel yields to the page (no preventDefault)', () => {
    renderWithIntl(<EditionChips editions={editions} selectedYear={null} />)
    // scrollLeft 300 == scrollWidth(500) - clientWidth(200): already at the end
    const { wheel } = fakeScroller({ scrollWidth: 500, clientWidth: 200, scrollLeft: 300 })
    const r = wheel({ deltaY: 120, deltaX: 0 })
    expect(r.scrollLeft).toBe(300)
    expect(r.prevented).toBe(false)
  })

  test('horizontal (trackpad) gestures pass through untouched', () => {
    renderWithIntl(<EditionChips editions={editions} selectedYear={null} />)
    const { wheel } = fakeScroller({ scrollWidth: 500, clientWidth: 200, scrollLeft: 0 })
    const r = wheel({ deltaY: 5, deltaX: 120 })
    expect(r.scrollLeft).toBe(0)
    expect(r.prevented).toBe(false)
  })

  // Desktop mouse: grab-and-drag scrolls the row, and the click that a drag
  // ends in must not navigate the chip under the cursor.
  test('mouse drag scrolls the row sideways', () => {
    renderWithIntl(<EditionChips editions={editions} selectedYear={null} />)
    const { nav } = fakeScroller({ scrollWidth: 500, clientWidth: 200, scrollLeft: 0 })
    fireEvent.pointerDown(nav, { pointerType: 'mouse', button: 0, pointerId: 1, clientX: 100 })
    fireEvent.pointerMove(nav, { pointerType: 'mouse', pointerId: 1, clientX: 40 }) // dx = -60
    expect(nav.scrollLeft).toBe(60) // startLeft(0) - dx(-60)
    fireEvent.pointerUp(nav, { pointerType: 'mouse', pointerId: 1 })
  })

  test('a click that ends a drag is cancelled (no navigation)', () => {
    renderWithIntl(<EditionChips editions={editions} selectedYear={null} />)
    const { nav } = fakeScroller({ scrollWidth: 500, clientWidth: 200, scrollLeft: 0 })
    fireEvent.pointerDown(nav, { pointerType: 'mouse', button: 0, pointerId: 1, clientX: 100 })
    fireEvent.pointerMove(nav, { pointerType: 'mouse', pointerId: 1, clientX: 40 })
    fireEvent.pointerUp(nav, { pointerType: 'mouse', pointerId: 1 })
    // fireEvent returns false when the handler called preventDefault
    const notPrevented = fireEvent.click(screen.getByRole('link', { name: '2025' }))
    expect(notPrevented).toBe(false)
  })

  test('a plain click (no drag) still navigates', () => {
    renderWithIntl(<EditionChips editions={editions} selectedYear={null} />)
    fakeScroller({ scrollWidth: 500, clientWidth: 200, scrollLeft: 0 })
    const notPrevented = fireEvent.click(screen.getByRole('link', { name: '2025' }))
    expect(notPrevented).toBe(true)
  })

  test('touch pointers are left to native scrolling (no JS drag)', () => {
    renderWithIntl(<EditionChips editions={editions} selectedYear={null} />)
    const { nav } = fakeScroller({ scrollWidth: 500, clientWidth: 200, scrollLeft: 0 })
    fireEvent.pointerDown(nav, { pointerType: 'touch', pointerId: 2, clientX: 100 })
    fireEvent.pointerMove(nav, { pointerType: 'touch', pointerId: 2, clientX: 40 })
    expect(nav.scrollLeft).toBe(0)
  })

  // Load-bearing: without draggable=false, grabbing a chip starts a native
  // link drag-and-drop that steals the pointer stream and the scroll dies.
  test('chips are not natively draggable', () => {
    renderWithIntl(<EditionChips editions={editions} selectedYear={null} />)
    expect(screen.getByRole('link', { name: 'all' })).toHaveAttribute('draggable', 'false')
    expect(screen.getByRole('link', { name: '2025' })).toHaveAttribute('draggable', 'false')
  })
})
