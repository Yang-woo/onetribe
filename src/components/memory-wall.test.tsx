import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { momentFixture, renderWithIntl } from '@/test-utils'
import { beforeAll, describe, expect, test, vi } from 'vitest'
import type { EditionChip, Moment } from '@/lib/moments'
import { MemoryWall } from './memory-wall'

// Spec: docs/15 §1 — empty state invites the first upload; realtime
// inserts appear at the top without a reload; no duplicates.

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

  test('cards carry the edition tag (year + anthem initials) and an anonymous meta line', () => {
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
    expect(screen.getByText('2024 POTT')).toBeInTheDocument()
    expect(screen.getByText('anonymous')).toBeInTheDocument()
  })
})
