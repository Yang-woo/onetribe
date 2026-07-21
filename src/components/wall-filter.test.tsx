import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { momentFixture, renderWithIntl } from '@/test-utils'
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import type { EditionChip, Moment } from '@/lib/moments'
import { WallFilter } from './wall-filter'

// Spec: docs/00 D13 — a chip click filters in the browser instead of navigating.
// The invariants it must not break: the first wall is server-rendered (deep
// link / share / crawler), the ?e= URL stays shareable through pushState and
// replays on back/forward, realtime rescopes to the new filter, and the live
// signal resets per view.

beforeAll(() => {
  globalThis.IntersectionObserver = class {
    observe() {}
    disconnect() {}
    unobserve() {}
    takeRecords() {
      return []
    }
    root = null
    rootMargin = ''
    thresholds = []
  } as unknown as typeof IntersectionObserver
})

beforeEach(() => {
  window.history.replaceState(null, '', '/en')
})

// Mirrors fetchEditions(): the Defqon.1 mainline, one event row per year,
// newest first. 2026 is the canceled one (the launch hook).
const editions: EditionChip[] = [
  { id: 'e2026', year: 2026, edition: 'Sacred Oath', canceled: true },
  { id: 'e2025', year: 2025, edition: 'Where Legends Rise', canceled: false },
  { id: 'e2024', year: 2024, edition: 'Power of the Tribe', canceled: false },
]

const moment = momentFixture
const noSubscribe = () => () => {}
const noLoadMore = async () => []

/** Moments keyed by the event the fetch asked for, so each filter is distinguishable. */
const byEvent: Record<string, Moment[]> = {
  e2026: [moment('a-2026', { event_id: 'e2026' })],
  e2025: [moment('a-2025', { event_id: 'e2025' })],
  e2024: [moment('a-2024', { event_id: 'e2024' })],
}
const fakeFetch = async ({ eventIds }: { eventIds?: string[] }) =>
  eventIds ? (byEvent[eventIds[0]!] ?? []) : [moment('a-all')]

function renderFilter(overrides: Partial<React.ComponentProps<typeof WallFilter>> = {}) {
  const props: React.ComponentProps<typeof WallFilter> = {
    editions,
    initialSelectedYear: null,
    fetchImpl: fakeFetch,
    subscribeImpl: noSubscribe,
    loadMoreImpl: noLoadMore,
    children: <div>server-wall</div>,
    ...overrides,
  }
  return renderWithIntl(<WallFilter {...props} />)
}

describe('WallFilter', () => {
  test('the server wall stands until the visitor filters', () => {
    renderFilter({ initialSelectedYear: 2025 })
    expect(screen.getByText('server-wall')).toBeInTheDocument()
    // the server's filter is what the chips reflect until the visitor acts
    expect(screen.getByRole('link', { name: '2025' })).toHaveAttribute('aria-current', 'page')
  })

  // Arriving on a deep link and *then* filtering is where the server's year and
  // the client's diverge. "all" is a real selection (null), not the absence of
  // one, so it must beat the year the server rendered rather than fall back to it.
  test('a deep-linked visitor can clear the filter, and re-pick the year they came in on', async () => {
    const user = userEvent.setup()
    renderFilter({ initialSelectedYear: 2025 })

    await user.click(screen.getByRole('link', { name: 'all' }))
    await screen.findByText('caption-a-all')
    expect(screen.getByRole('link', { name: '2025' })).not.toHaveAttribute('aria-current')
    expect(screen.getByRole('link', { name: 'all' })).toHaveAttribute('aria-current', 'page')

    // the deep-link year is selectable again — the re-tap guard must not think
    // we never left it
    await user.click(screen.getByRole('link', { name: '2025' }))
    expect(await screen.findByText('caption-a-2025')).toBeInTheDocument()
  })

  test('a deep-linked visitor filtering to another year fetches that year', async () => {
    const user = userEvent.setup()
    const fetchImpl = vi.fn(fakeFetch)
    renderFilter({ initialSelectedYear: 2025, fetchImpl })

    await user.click(screen.getByRole('link', { name: '2024' }))

    expect(fetchImpl).toHaveBeenCalledWith({ eventIds: ['e2024'] })
    expect(await screen.findByText('caption-a-2024')).toBeInTheDocument()
    expect(screen.queryByText('server-wall')).not.toBeInTheDocument()
  })

  test('re-tapping the year the server rendered does not refetch', async () => {
    const user = userEvent.setup()
    const fetchImpl = vi.fn(fakeFetch)
    renderFilter({ initialSelectedYear: 2025, fetchImpl })

    await user.click(screen.getByRole('link', { name: '2025' }))

    expect(fetchImpl).not.toHaveBeenCalled()
    expect(screen.getByText('server-wall')).toBeInTheDocument()
  })

  test('a chip click swaps the wall in place, fetching only that year', async () => {
    const user = userEvent.setup()
    const fetchImpl = vi.fn(fakeFetch)
    renderFilter({ fetchImpl })

    await user.click(screen.getByRole('link', { name: '2025' }))

    expect(fetchImpl).toHaveBeenCalledWith({ eventIds: ['e2025'] })
    expect(await screen.findByText('caption-a-2025')).toBeInTheDocument()
    // the server wall is gone — the client owns the wall from here on
    expect(screen.queryByText('server-wall')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '2025' })).toHaveAttribute('aria-current', 'page')
  })

  test('the ?e= URL follows the filter so the view stays shareable', async () => {
    const user = userEvent.setup()
    renderFilter()

    await user.click(screen.getByRole('link', { name: '2024' }))
    await screen.findByText('caption-a-2024')
    expect(window.location.pathname).toBe('/en') // locale prefix survives
    expect(window.location.search).toBe('?e=2024')

    await user.click(screen.getByRole('link', { name: 'all' }))
    await screen.findByText('caption-a-all')
    expect(window.location.search).toBe('')
  })

  test('back replays the previous filter in the browser', async () => {
    const user = userEvent.setup()
    renderFilter()

    await user.click(screen.getByRole('link', { name: '2025' }))
    await screen.findByText('caption-a-2025')
    await user.click(screen.getByRole('link', { name: '2024' }))
    await screen.findByText('caption-a-2024')

    act(() => {
      window.history.back()
    })

    await waitFor(() => expect(screen.getByText('caption-a-2025')).toBeInTheDocument())
    expect(window.location.search).toBe('?e=2025')
    expect(screen.queryByText('caption-a-2024')).not.toBeInTheDocument()
  })

  test('back past the first filter restores the unfiltered wall', async () => {
    const user = userEvent.setup()
    renderFilter()

    await user.click(screen.getByRole('link', { name: '2025' }))
    await screen.findByText('caption-a-2025')

    act(() => {
      window.history.back() // back to /en — no ?e= at all
    })

    await waitFor(() => expect(screen.getByText('caption-a-all')).toBeInTheDocument())
    expect(window.location.search).toBe('')
    expect(screen.getByRole('link', { name: 'all' })).toHaveAttribute('aria-current', 'page')
  })

  // A hand-typed or stale ?e= must land on the unfiltered wall, not query a
  // junk year (shared with the server via parseEditionYear).
  test('popping to a junk ?e= falls back to the unfiltered wall', async () => {
    const user = userEvent.setup()
    renderFilter()

    await user.click(screen.getByRole('link', { name: '2025' }))
    await screen.findByText('caption-a-2025')

    act(() => {
      window.history.replaceState(null, '', '/en?e=nope')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })

    await waitFor(() => expect(screen.getByText('caption-a-all')).toBeInTheDocument())
  })

  test('the filter header follows the selection, including the canceled edition', async () => {
    const user = userEvent.setup()
    renderFilter()

    await user.click(screen.getByRole('link', { name: '2026 — Sacred Oath' }))
    expect(
      await screen.findByRole('heading', { name: '2026 — Sacred Oath' }),
    ).toBeInTheDocument()
    expect(screen.getByText(/The Gathering happened/)).toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: '2024' }))
    expect(
      await screen.findByRole('heading', { name: '2024 — Power of the Tribe' }),
    ).toBeInTheDocument()

    // unfiltered view carries no edition header at all
    await user.click(screen.getByRole('link', { name: 'all' }))
    await screen.findByText('caption-a-all')
    expect(screen.queryByRole('heading', { name: /Power of the Tribe/ })).not.toBeInTheDocument()
  })

  // The rescope only proves itself across a *second* filter: the subscription
  // has to be torn down and re-opened against the new edition, not just scoped
  // right on first mount.
  test('realtime rescopes when the filter changes, and drops the old subscription', async () => {
    const user = userEvent.setup()
    let emit: (m: Moment) => void = () => {}
    const unsubscribe = vi.fn()
    const subscribeImpl = vi.fn((onInsert: (m: Moment) => void) => {
      emit = onInsert
      return unsubscribe
    })
    renderFilter({ subscribeImpl })

    await user.click(screen.getByRole('link', { name: '2024' }))
    await screen.findByText('caption-a-2024')
    act(() => {
      emit(moment('fresh-2024', { event_id: 'e2024' }))
    })
    expect(screen.getByText('caption-fresh-2024')).toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: '2025' }))
    await screen.findByText('caption-a-2025')

    // the 2024 channel must be gone, not left leaking alongside the new one
    expect(unsubscribe).toHaveBeenCalled()
    expect(subscribeImpl).toHaveBeenCalledTimes(2)

    act(() => {
      emit(moment('fresh-2024b', { event_id: 'e2024' })) // the old edition
      emit(moment('fresh-2025', { event_id: 'e2025' })) // the new one
    })
    expect(screen.queryByText('caption-fresh-2024b')).not.toBeInTheDocument()
    expect(screen.getByText('caption-fresh-2025')).toBeInTheDocument()
  })

  // The unfiltered wall takes everything — rescoping to "all" must not leave
  // the previous edition's filter behind.
  test('clearing the filter rescopes realtime back to every edition', async () => {
    const user = userEvent.setup()
    let emit: (m: Moment) => void = () => {}
    const subscribeImpl = (onInsert: (m: Moment) => void) => {
      emit = onInsert
      return () => {}
    }
    renderFilter({ subscribeImpl })

    await user.click(screen.getByRole('link', { name: '2024' }))
    await screen.findByText('caption-a-2024')
    await user.click(screen.getByRole('link', { name: 'all' }))
    await screen.findByText('caption-a-all')

    act(() => {
      emit(moment('fresh-2026', { event_id: 'e2026' }))
    })
    expect(screen.getByText('caption-fresh-2026')).toBeInTheDocument()
  })

  test('the live signal resets when the filter changes', async () => {
    const user = userEvent.setup()
    let emit: (m: Moment) => void = () => {}
    const subscribeImpl = (onInsert: (m: Moment) => void) => {
      emit = onInsert
      return () => {}
    }
    renderFilter({ subscribeImpl })

    await user.click(screen.getByRole('link', { name: '2024' }))
    await screen.findByText('caption-a-2024')
    act(() => {
      emit(moment('fresh-2024', { event_id: 'e2024' }))
    })
    expect(screen.getByText(/1 moment just landed/)).toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: '2025' }))
    await screen.findByText('caption-a-2025')
    expect(screen.queryByText(/just landed/)).not.toBeInTheDocument()
  })

  test('re-tapping the active chip does not refetch', async () => {
    const user = userEvent.setup()
    const fetchImpl = vi.fn(fakeFetch)
    renderFilter({ fetchImpl })

    await user.click(screen.getByRole('link', { name: '2025' }))
    await screen.findByText('caption-a-2025')
    fetchImpl.mockClear()

    await user.click(screen.getByRole('link', { name: '2025' }))
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  test('the chip pulses and the wall dims while the fetch is in flight', async () => {
    const user = userEvent.setup()
    let release!: (m: Moment[]) => void
    const fetchImpl = () => new Promise<Moment[]>((resolve) => (release = resolve))
    renderFilter({ fetchImpl })

    await user.click(screen.getByRole('link', { name: '2024' }))

    expect(screen.getByText('2024')).toHaveClass('animate-pulse')
    expect(screen.getByText('server-wall').closest('[aria-busy]')).toHaveAttribute(
      'aria-busy',
      'true',
    )

    await act(async () => {
      release([moment('a-2024', { event_id: 'e2024' })])
    })

    expect(await screen.findByText('caption-a-2024')).toBeInTheDocument()
    expect(screen.getByText('2024')).not.toHaveClass('animate-pulse')
    expect(screen.getByText('caption-a-2024').closest('[aria-busy]')).toHaveAttribute(
      'aria-busy',
      'false',
    )
  })

  // "all" filters to null, which is also "nothing is pending" — so the pending
  // chip is tracked with an 'all' sentinel. Without it the cue lands nowhere.
  test('clearing the filter pulses the "all" chip while it loads', async () => {
    const user = userEvent.setup()
    let release!: (m: Moment[]) => void
    const fetchImpl = vi
      .fn<typeof fakeFetch>()
      .mockImplementationOnce(fakeFetch)
      .mockImplementationOnce(() => new Promise<Moment[]>((resolve) => (release = resolve)))
    renderFilter({ fetchImpl })

    await user.click(screen.getByRole('link', { name: '2024' }))
    await screen.findByText('caption-a-2024')

    await user.click(screen.getByRole('link', { name: 'all' }))
    expect(screen.getByText('all')).toHaveClass('animate-pulse')
    expect(screen.getByText('2024')).not.toHaveClass('animate-pulse')

    await act(async () => {
      release([moment('a-all')])
    })
    expect(screen.getByText('all')).not.toHaveClass('animate-pulse')
  })

  // A popstate that doesn't move the filter (another entry, or a router that
  // re-announces the same URL) must leave the wall alone — refetching would
  // remount it and throw away the pages infinite scroll already loaded.
  test('a popstate that lands on the current filter leaves the wall untouched', async () => {
    const user = userEvent.setup()
    let emit: (m: Moment) => void = () => {}
    const fetchImpl = vi.fn(fakeFetch)
    const subscribeImpl = (onInsert: (m: Moment) => void) => {
      emit = onInsert
      return () => {}
    }
    renderFilter({ fetchImpl, subscribeImpl })

    await user.click(screen.getByRole('link', { name: '2025' }))
    await screen.findByText('caption-a-2025')
    act(() => {
      emit(moment('fresh-2025', { event_id: 'e2025' }))
    })
    fetchImpl.mockClear()

    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate')) // still ?e=2025
    })

    expect(fetchImpl).not.toHaveBeenCalled()
    // the session's live signal and its moment survived
    expect(screen.getByText(/1 moment just landed/)).toBeInTheDocument()
    expect(screen.getByText('caption-fresh-2025')).toBeInTheDocument()
  })

  // Better a reload that renders the truth than a wall quietly showing the old
  // edition under the new edition's URL.
  test('a failed fetch hands the pushed URL back to the server', async () => {
    const user = userEvent.setup()
    const reloadImpl = vi.fn()
    const fetchImpl = vi.fn(async () => {
      throw new Error('fetchMoments failed: network')
    })
    renderFilter({ fetchImpl, reloadImpl })

    await user.click(screen.getByRole('link', { name: '2024' }))

    await waitFor(() => expect(reloadImpl).toHaveBeenCalled())
    expect(window.location.search).toBe('?e=2024') // the URL the server must render
  })

  test('a stale fetch failure cannot reload out from under a newer filter', async () => {
    const user = userEvent.setup()
    const reloadImpl = vi.fn()
    const calls: Array<{ resolve: (m: Moment[]) => void; reject: (e: Error) => void }> = []
    const fetchImpl = () =>
      new Promise<Moment[]>((resolve, reject) => calls.push({ resolve, reject }))
    renderFilter({ fetchImpl, reloadImpl })

    await user.click(screen.getByRole('link', { name: '2025' }))
    await user.click(screen.getByRole('link', { name: '2024' }))

    await act(async () => {
      calls[1]!.resolve([moment('a-2024', { event_id: 'e2024' })]) // newer wins
    })
    await act(async () => {
      calls[0]!.reject(new Error('stale')) // the abandoned 2025 fetch dies
    })

    expect(reloadImpl).not.toHaveBeenCalled()
    expect(screen.getByText('caption-a-2024')).toBeInTheDocument()
  })

  // Chips are faster to tap than Supabase is to answer; without the guard the
  // first (slower) response would land last and win.
  test('a slow earlier fetch cannot overwrite a newer filter', async () => {
    const user = userEvent.setup()
    const pending: Array<(m: Moment[]) => void> = []
    const fetchImpl = () => new Promise<Moment[]>((resolve) => pending.push(resolve))
    renderFilter({ fetchImpl })

    await user.click(screen.getByRole('link', { name: '2025' }))
    await user.click(screen.getByRole('link', { name: '2024' }))

    // 2024 (the newer click) answers first, then the stale 2025 straggles in
    await act(async () => {
      pending[1]!([moment('a-2024', { event_id: 'e2024' })])
    })
    await act(async () => {
      pending[0]!([moment('a-2025', { event_id: 'e2025' })])
    })

    expect(screen.getByText('caption-a-2024')).toBeInTheDocument()
    expect(screen.queryByText('caption-a-2025')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '2024' })).toHaveAttribute('aria-current', 'page')
  })
})
