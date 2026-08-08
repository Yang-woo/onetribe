import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { installIntersectionObserver, momentFixture, renderWithIntl } from '@/test-utils'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import type { EditionChip, Moment } from '@/lib/moments'
import { MemoryWall, WALL_AUTO_PAGES } from './memory-wall'

// Spec: docs/15 §1 — empty state invites the first upload; realtime
// inserts appear at the top without a reload; no duplicates.

// Installed but never fired for most tests — they only need the constructor to
// exist. The two that drive the sentinel install their own and fire it.
let restoreObserver: () => void
beforeAll(() => {
  ;({ restore: restoreObserver } = installIntersectionObserver())
})
afterAll(() => restoreObserver())

const moment = momentFixture

const noSubscribe = () => () => {}
const noLoadMore = async () => []

describe('MemoryWall', () => {
  test('empty wall shows the waking-up state with an invitation', () => {
    renderWithIntl(
      <MemoryWall initialMoments={[]} loadMoreImpl={noLoadMore} subscribeImpl={noSubscribe} />,
    )
    expect(screen.getByText('the wall is waking up')).toBeInTheDocument()
    expect(screen.getByText(/be one of the first/)).toBeInTheDocument()
  })

  test('renders initial moments with captions', () => {
    renderWithIntl(
      <MemoryWall
        initialMoments={[moment('a'), moment('b')]}
        loadMoreImpl={noLoadMore}
        subscribeImpl={noSubscribe}
      />,
    )
    expect(screen.getByText('caption-a')).toBeInTheDocument()
    expect(screen.getByText('caption-b')).toBeInTheDocument()
  })

  test('a realtime insert appears at the top, once', () => {
    let emit: (m: Moment) => void = () => {}
    const subscribe = (onInsert: (m: Moment) => void) => {
      emit = onInsert
      return () => {}
    }
    renderWithIntl(
      <MemoryWall
        initialMoments={[moment('old')]}
        loadMoreImpl={noLoadMore}
        subscribeImpl={subscribe}
      />,
    )

    act(() => {
      emit(moment('fresh'))
      emit(moment('fresh')) // duplicate delivery must not double-render
    })

    const captions = screen.getAllByText(/^caption-/).map((el) => el.textContent)
    expect(captions).toEqual(['caption-fresh', 'caption-old'])
  })

  // The lightbox tracks the open moment by id, not index: a live insert prepends
  // to the wall, which would slide an index-based pointer onto a different card.
  test('a live insert while the lightbox is open keeps it on the same moment', async () => {
    const user = userEvent.setup()
    let emit: (m: Moment) => void = () => {}
    const subscribe = (onInsert: (m: Moment) => void) => {
      emit = onInsert
      return () => {}
    }
    renderWithIntl(
      <MemoryWall
        initialMoments={[moment('a'), moment('b')]}
        loadMoreImpl={noLoadMore}
        subscribeImpl={subscribe}
      />,
    )

    // open the moment 'a' (its card button is named by the caption)
    await user.click(screen.getByRole('button', { name: 'caption-a' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('caption-a')).toBeInTheDocument()

    // a live insert prepends 'fresh' → an index-based lightbox would jump to it
    act(() => emit(moment('fresh')))

    expect(within(dialog).getByText('caption-a')).toBeInTheDocument()
    expect(within(dialog).queryByText('caption-fresh')).not.toBeInTheDocument()
  })

  test('lightbox next/prev navigates by id mapping', async () => {
    const user = userEvent.setup()
    renderWithIntl(
      <MemoryWall
        initialMoments={[moment('a'), moment('b')]}
        loadMoreImpl={noLoadMore}
        subscribeImpl={noSubscribe}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'caption-a' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('caption-a')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'next' }))
    expect(within(dialog).getByText('caption-b')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'previous' }))
    expect(within(dialog).getByText('caption-a')).toBeInTheDocument()
  })

  test('realtime inserts for other editions are ignored when filtered', () => {
    let emit: (m: Moment) => void = () => {}
    const subscribe = (onInsert: (m: Moment) => void) => {
      emit = onInsert
      return () => {}
    }
    renderWithIntl(
      <MemoryWall
        initialMoments={[moment('old')]}
        eventIds={['event-1']}
        loadMoreImpl={noLoadMore}
        subscribeImpl={subscribe}
      />,
    )

    act(() => {
      emit(moment('other', { event_id: 'event-2' }))
    })

    expect(screen.queryByText('caption-other')).not.toBeInTheDocument()
  })

  test('load more appends without duplicating existing moments', async () => {
    const user = (await import('@testing-library/user-event')).default.setup()
    const loadMore = vi.fn(async () => [moment('old'), moment('new')])
    renderWithIntl(
      <MemoryWall
        initialMoments={Array.from({ length: 40 }, (_, i) => moment(`m${i}`))}
        loadMoreImpl={loadMore}
        subscribeImpl={noSubscribe}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'more moments' }))

    // compound keyset cursor (created_at + id) so batch siblings aren't skipped
    expect(loadMore).toHaveBeenCalledWith({ createdAt: '2026-07-12T00:00:00Z', id: 'm39' })
    expect(screen.getAllByText('caption-old')).toHaveLength(1)
    expect(screen.getByText('caption-new')).toBeInTheDocument()
  })

  test('a failed page parks auto-loading so the observer stops re-firing, and recovers on a manual retry', async () => {
    // Drive the sentinel-into-view path directly — that's where the infinite
    // spin lived.
    const { fireAll, restore } = installIntersectionObserver()

    try {
      const user = (await import('@testing-library/user-event')).default.setup()
      let attempt = 0
      const loadMore = vi.fn(async () => {
        attempt += 1
        if (attempt === 1) throw new Error('offline')
        return [moment('recovered')]
      })
      renderWithIntl(
        <MemoryWall
          initialMoments={Array.from({ length: 40 }, (_, i) => moment(`m${i}`))}
          loadMoreImpl={loadMore}
          subscribeImpl={noSubscribe}
        />,
      )
      const scrollSentinelIntoView = () => fireAll()

      // first intersection loads a page — which fails
      await act(async () => {
        scrollSentinelIntoView()
      })
      expect(loadMore).toHaveBeenCalledTimes(1)

      // further intersections must NOT re-fire: a failed page parks auto-loading.
      // (Dropping the catch OR the `!failed` observer guard spins here → >1 call.)
      await act(async () => {
        scrollSentinelIntoView()
      })
      await act(async () => {
        scrollSentinelIntoView()
      })
      expect(loadMore).toHaveBeenCalledTimes(1)

      // the wall is not marked exhausted, so a deliberate button retry recovers
      await user.click(screen.getByRole('button', { name: 'more moments' }))
      expect(loadMore).toHaveBeenCalledTimes(2)
      expect(screen.getByText('caption-recovered')).toBeInTheDocument()
    } finally {
      restore()
    }
  })

  test('the sentinel stops after WALL_AUTO_PAGES — the bottom has to stop retreating', async () => {
    // The cap works by tearing the observer down, so this has to be a stand-in
    // that honours disconnect() — one that kept firing a disconnected observer
    // would report a cap that isn't there.
    const { fireAll, restore } = installIntersectionObserver()

    try {
      const user = userEvent.setup()
      let page = 0
      // A full page every time: the wall is never exhausted, so only the cap
      // can stop the auto-loading (docs/00 D51).
      const loadMore = vi.fn(async () => {
        page += 1
        return Array.from({ length: 40 }, (_, i) => moment(`p${page}-${i}`))
      })
      renderWithIntl(
        <MemoryWall
          initialMoments={Array.from({ length: 40 }, (_, i) => moment(`m${i}`))}
          loadMoreImpl={loadMore}
          subscribeImpl={noSubscribe}
        />,
      )
      const scrollSentinelIntoView = async () => {
        await act(async () => {
          fireAll()
        })
      }

      for (let i = 0; i < WALL_AUTO_PAGES; i += 1) await scrollSentinelIntoView()
      expect(loadMore).toHaveBeenCalledTimes(WALL_AUTO_PAGES)

      // Past the cap the observer is gone: reaching the bottom appends nothing,
      // so the footer below the wall finally stays put.
      await scrollSentinelIntoView()
      await scrollSentinelIntoView()
      expect(loadMore).toHaveBeenCalledTimes(WALL_AUTO_PAGES)

      // The wall is still endless — it just waits to be asked now, and asking
      // never hands control back to the sentinel.
      await user.click(screen.getByRole('button', { name: 'more moments' }))
      expect(loadMore).toHaveBeenCalledTimes(WALL_AUTO_PAGES + 1)
      await scrollSentinelIntoView()
      expect(loadMore).toHaveBeenCalledTimes(WALL_AUTO_PAGES + 1)
    } finally {
      restore()
    }
  })

  // docs/15 §1 — filtered views get an edition header; the live signal counts
  // this session's inserts and only appears once something has landed.
  test('a fully-canceled year with no anthem keeps the generic remembers-the-edition line', () => {
    const covid: EditionChip = { id: 'e2021', year: 2021, edition: null, canceled: true }
    renderWithIntl(
      <MemoryWall
        initialMoments={[]}
        filterEdition={covid}
        loadMoreImpl={noLoadMore}
        subscribeImpl={noSubscribe}
      />,
    )
    expect(screen.getByText(/the wall remembers the edition that never opened/)).toBeInTheDocument()
    expect(screen.queryByText(/The Gathering happened/)).not.toBeInTheDocument()
  })

  test('a canceled-year filter shows the anthem-title header and a live signal after an insert', () => {
    let emit: (m: Moment) => void = () => {}
    const subscribe = (onInsert: (m: Moment) => void) => {
      emit = onInsert
      return () => {}
    }
    const lost: EditionChip = { id: 'e2026', year: 2026, edition: 'Sacred Oath', canceled: true }
    renderWithIntl(
      <MemoryWall
        initialMoments={[moment('a', { event_id: 'e2026' })]}
        eventIds={['e2026']}
        filterEdition={lost}
        subscribeImpl={subscribe}
        loadMoreImpl={noLoadMore}
      />,
    )

    expect(screen.getByRole('heading', { name: '2026 — Sacred Oath' })).toBeInTheDocument()
    expect(screen.getByText(/The Gathering happened/)).toBeInTheDocument() // 2026 partly happened → Gathering note
    expect(screen.queryByText(/just landed/)).not.toBeInTheDocument()

    act(() => {
      emit(moment('fresh', { event_id: 'e2026' }))
      emit(moment('fresh', { event_id: 'e2026' })) // duplicate delivery must not double-count
    })
    expect(screen.getByText(/1 moment just landed/)).toBeInTheDocument()
  })

  test('a normal edition filter titles by anthem with no lost-weekend subtitle', () => {
    const ed: EditionChip = {
      id: 'e2024',
      year: 2024,
      edition: 'Power of the Tribe',
      canceled: false,
    }
    renderWithIntl(
      <MemoryWall
        initialMoments={[moment('a', { event_id: 'e2024' })]}
        filterEdition={ed}
        editionById={new Map([['e2024', ed]])}
        loadMoreImpl={noLoadMore}
        subscribeImpl={noSubscribe}
      />,
    )
    expect(screen.getByRole('heading', { name: '2024 — Power of the Tribe' })).toBeInTheDocument()
    expect(screen.queryByText(/never opened/)).not.toBeInTheDocument()
  })

  test('cards carry the edition tag (year + anthem, spelled out) and an anonymous meta line', () => {
    const ed: EditionChip = {
      id: 'e2024',
      year: 2024,
      edition: 'Power of the Tribe',
      canceled: false,
    }
    renderWithIntl(
      <MemoryWall
        initialMoments={[moment('a', { event_id: 'e2024', author_name: null })]}
        editionById={new Map([['e2024', ed]])}
        loadMoreImpl={noLoadMore}
        subscribeImpl={noSubscribe}
      />,
    )
    // spelled out, not initials: "2024 POTT" meant nothing to a reader who
    // didn't already know the anthem. Same shape as the modal/filter header.
    expect(screen.getByText('2024 — Power of the Tribe')).toBeInTheDocument()
    expect(screen.getByText('anonymous')).toBeInTheDocument()
  })
})
