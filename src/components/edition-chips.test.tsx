import { fireEvent, screen } from '@testing-library/react'
import { renderWithIntl } from '@/test-utils'
import { describe, expect, test, vi } from 'vitest'
import type { EditionChip } from '@/lib/moments'
import { EditionChips } from './edition-chips'

// Spec: docs/15 §1 — edition chips filter the wall; the filter lives in the
// URL (?e=YYYY) and the canceled 2026 edition still shows its real anthem
// title (Sacred Oath). Per docs/00 D13 the click is filtered in the browser (onSelect)
// rather than navigating, so every render here wires onSelect the way the
// only caller (WallFilter) does.

const noop = () => {}

const renderChips = (overrides: Partial<Parameters<typeof EditionChips>[0]> = {}) =>
  renderWithIntl(
    <EditionChips editions={editions} selectedYear={null} onSelect={noop} {...overrides} />,
  )

const editions: EditionChip[] = [
  { id: 'e2026', year: 2026, edition: 'Sacred Oath', canceled: true },
  { id: 'e2025', year: 2025, edition: null, canceled: false },
  { id: 'e2019', year: 2019, edition: 'One Tribe', canceled: false },
]

describe('EditionChips', () => {
  test('renders an "all" chip plus one chip per edition, locale-prefixed links (T3.1)', () => {
    renderChips()
    expect(screen.getByRole('link', { name: 'all' })).toHaveAttribute('href', '/en')
    expect(screen.getByRole('link', { name: '2025' })).toHaveAttribute('href', '/en?e=2025')
    expect(screen.getByRole('link', { name: '2019' })).toHaveAttribute('href', '/en?e=2019')
  })

  test('the canceled 2026 edition shows its anthem title (launch hook)', () => {
    renderChips()
    expect(screen.getByRole('link', { name: '2026 — Sacred Oath' })).toBeInTheDocument()
  })

  test('the selected year is marked as current', () => {
    renderChips({ selectedYear: 2025 })
    expect(screen.getByRole('link', { name: '2025' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: '2019' })).not.toHaveAttribute('aria-current')
    expect(screen.getByRole('link', { name: 'all' })).not.toHaveAttribute('aria-current')
  })

  // "all" is a selection too. Nothing navigates any more, so aria-current is
  // the only thing telling a screen reader which filter is live.
  test('the unfiltered wall marks the "all" chip as current', () => {
    renderChips()
    expect(screen.getByRole('link', { name: 'all' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: '2025' })).not.toHaveAttribute('aria-current')
  })

  // Desktop mouse: a vertical wheel must scroll the overflowing row sideways
  // (macOS hides the scrollbar and a mouse can't reach it) but yield to the
  // page at the ends. jsdom has no layout, so fake the scroll metrics.
  function fakeScroller(overflow: {
    scrollWidth: number
    clientWidth: number
    scrollLeft: number
  }) {
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
    renderChips()
    const { wheel } = fakeScroller({ scrollWidth: 500, clientWidth: 200, scrollLeft: 0 })
    const r = wheel({ deltaY: 120, deltaX: 0 })
    expect(r.scrollLeft).toBe(120)
    expect(r.prevented).toBe(true)
  })

  test('at the right edge, the wheel yields to the page (no preventDefault)', () => {
    renderChips()
    // scrollLeft 300 == scrollWidth(500) - clientWidth(200): already at the end
    const { wheel } = fakeScroller({ scrollWidth: 500, clientWidth: 200, scrollLeft: 300 })
    const r = wheel({ deltaY: 120, deltaX: 0 })
    expect(r.scrollLeft).toBe(300)
    expect(r.prevented).toBe(false)
  })

  test('horizontal (trackpad) gestures pass through untouched', () => {
    renderChips()
    const { wheel } = fakeScroller({ scrollWidth: 500, clientWidth: 200, scrollLeft: 0 })
    const r = wheel({ deltaY: 5, deltaX: 120 })
    expect(r.scrollLeft).toBe(0)
    expect(r.prevented).toBe(false)
  })

  // Desktop mouse: grab-and-drag scrolls the row, and the click a drag ends in
  // must neither filter nor navigate the chip under the cursor.
  test('mouse drag scrolls the row sideways', () => {
    renderChips()
    const { nav } = fakeScroller({ scrollWidth: 500, clientWidth: 200, scrollLeft: 0 })
    fireEvent.pointerDown(nav, { pointerType: 'mouse', button: 0, pointerId: 1, clientX: 100 })
    fireEvent.pointerMove(nav, { pointerType: 'mouse', pointerId: 1, clientX: 40 }) // dx = -60
    expect(nav.scrollLeft).toBe(60) // startLeft(0) - dx(-60)
    fireEvent.pointerUp(nav, { pointerType: 'mouse', pointerId: 1 })
  })

  test('a click that ends a drag is cancelled', () => {
    const onSelect = vi.fn()
    renderChips({ onSelect })
    const { nav } = fakeScroller({ scrollWidth: 500, clientWidth: 200, scrollLeft: 0 })
    fireEvent.pointerDown(nav, { pointerType: 'mouse', button: 0, pointerId: 1, clientX: 100 })
    fireEvent.pointerMove(nav, { pointerType: 'mouse', pointerId: 1, clientX: 40 })
    fireEvent.pointerUp(nav, { pointerType: 'mouse', pointerId: 1 })

    // fireEvent returns false when the handler called preventDefault
    const notPrevented = fireEvent.click(screen.getByRole('link', { name: '2025' }))
    expect(onSelect).not.toHaveBeenCalled() // no filter…
    expect(notPrevented).toBe(false) // …and no navigation either
  })

  // The counterpart to the drag-cancel test above: no drag → the click both
  // filters and is prevented (the chip never navigates). This is the canonical
  // "a chip click filters instead of navigating" case.
  test('a plain click (no drag) filters and is prevented', () => {
    const onSelect = vi.fn()
    renderChips({ onSelect })
    fakeScroller({ scrollWidth: 500, clientWidth: 200, scrollLeft: 0 })
    const notPrevented = fireEvent.click(screen.getByRole('link', { name: '2025' }))
    expect(onSelect).toHaveBeenCalledWith(2025)
    expect(notPrevented).toBe(false)
  })

  test('touch pointers are left to native scrolling (no JS drag)', () => {
    renderChips()
    const { nav } = fakeScroller({ scrollWidth: 500, clientWidth: 200, scrollLeft: 0 })
    fireEvent.pointerDown(nav, { pointerType: 'touch', pointerId: 2, clientX: 100 })
    fireEvent.pointerMove(nav, { pointerType: 'touch', pointerId: 2, clientX: 40 })
    expect(nav.scrollLeft).toBe(0)
  })

  // Load-bearing: without draggable=false, grabbing a chip starts a native
  // link drag-and-drop that steals the pointer stream and the scroll dies.
  test('chips are not natively draggable', () => {
    renderChips()
    expect(screen.getByRole('link', { name: 'all' })).toHaveAttribute('draggable', 'false')
    expect(screen.getByRole('link', { name: '2025' })).toHaveAttribute('draggable', 'false')
  })

  test('the "all" chip clears the filter', () => {
    const onSelect = vi.fn()
    renderChips({ selectedYear: 2025, onSelect })
    fireEvent.click(screen.getByRole('link', { name: 'all' }))
    expect(onSelect).toHaveBeenCalledWith(null)
  })

  describe('pending cue', () => {
    // cmd/ctrl-click means "open this filter in a new tab" — intercepting it
    // would swallow the click and open nothing.
    test('a modified click falls through to the real link', () => {
      const onSelect = vi.fn()
      renderChips({ onSelect })
      const notPrevented = fireEvent.click(screen.getByRole('link', { name: '2025' }), {
        metaKey: true,
      })
      expect(onSelect).not.toHaveBeenCalled()
      expect(notPrevented).toBe(true)
    })

    test('the pending chip pulses — and only that one', () => {
      renderWithIntl(
        <EditionChips editions={editions} selectedYear={null} onSelect={noop} pendingYear={2025} />,
      )
      expect(screen.getByText('2025')).toHaveClass('animate-pulse')
      expect(screen.getByText('all')).not.toHaveClass('animate-pulse')
    })

    // 'all' is a sentinel because null already means "nothing is pending"
    test('the pending "all" chip pulses on its own', () => {
      renderWithIntl(
        <EditionChips editions={editions} selectedYear={2025} onSelect={noop} pendingYear="all" />,
      )
      expect(screen.getByText('all')).toHaveClass('animate-pulse')
      expect(screen.getByText('2025')).not.toHaveClass('animate-pulse')
    })

    test('nothing pulses when no fetch is in flight', () => {
      renderChips({ selectedYear: 2025 })
      expect(screen.getByText('all')).not.toHaveClass('animate-pulse')
      expect(screen.getByText('2025')).not.toHaveClass('animate-pulse')
    })
  })
})
