import { act, screen } from '@testing-library/react'
import { renderWithIntl } from '@/test-utils'
import { beforeAll, describe, expect, test, vi } from 'vitest'
import type { Moment } from '@/lib/moments'
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

function moment(id: string, overrides: Partial<Moment> = {}): Moment {
  return {
    id,
    event_id: 'event-1',
    media_url: `https://media.test/${id}.jpg`,
    thumb_url: null,
    media_kind: 'image',
    embed_url: null,
    clip_start: null,
    clip_length: null,
    caption: `caption-${id}`,
    source_lang: null,
    author_name: null,
    author_link: null,
    origin_country: null,
    status: 'live',
    created_at: '2026-07-12T00:00:00Z',
    ...overrides,
  }
}

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

    expect(loadMore).toHaveBeenCalledWith('2026-07-12T00:00:00Z')
    expect(screen.getAllByText('caption-old')).toHaveLength(1)
    expect(screen.getByText('caption-new')).toBeInTheDocument()
  })
})
