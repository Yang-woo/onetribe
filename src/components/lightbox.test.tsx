import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import type { EditionChip } from '@/lib/moments'
import { momentFixture, renderWithIntl, withIntl } from '@/test-utils'
import { Lightbox, type TranslateImpl } from './lightbox'

// Spec: docs/15 §1 + wall UX pass — tapping a card opens the moment IN the
// modal (caption, edition, Instagram) with a clear "view details ↗" permalink;
// Esc / backdrop close, a click on the content panel does not.

const editionById = new Map<string, EditionChip>([
  ['event-1', { id: 'event-1', year: 2024, edition: 'Power of the Tribe', canceled: false }],
])

/**
 * The translation effect schedules a timer, so a microtask flush proves
 * nothing about it — every assertion on "did it translate" has to cross a
 * macrotask boundary or it passes for code that never ran.
 */
const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)))

// The modal is opened BY ID (docs/00 D33) — `open(n)` names the nth moment of
// the list so the tests still read positionally, while what crosses the prop
// boundary is the id the hosts actually hold.
function open(index: number, moments = [momentFixture('a'), momentFixture('b')], extra = {}) {
  const onClose = vi.fn()
  const onNavigate = vi.fn()
  renderWithIntl(
    <Lightbox
      moments={moments}
      openId={moments[index]!.id}
      editionById={editionById}
      onClose={onClose}
      onNavigate={onNavigate}
      translateImpl={async () => null}
      // These tests are about WHAT the modal shows, not when it translates —
      // the debounce window itself is covered by its own test below.
      translateDelayMs={0}
      {...extra}
    />,
  )
  return { onClose, onNavigate }
}

describe('Lightbox (moment modal)', () => {
  test('surfaces the moment context: edition line, caption and a permalink', () => {
    open(0)
    expect(screen.getByText('2024 — Power of the Tribe')).toBeInTheDocument()
    expect(screen.getByText('caption-a')).toBeInTheDocument()
    // the permalink to the full moment page is prominent (was an easy-to-miss link)
    expect(screen.getByRole('link', { name: /view details/ })).toHaveAttribute('href', '/en/m/a')
  })

  test('shows the caption translated in the modal teaser (D32)', async () => {
    // source_lang differs from the viewer locale (en) → it translates
    open(0, [momentFixture('a', { source_lang: 'nl' })], {
      translateImpl: async () => '번역된 캡션',
    })
    // the translation arrives asynchronously and replaces the original
    expect(await screen.findByText('번역된 캡션')).toBeInTheDocument()
    // the teaser has no original toggle — that (and the full text) lives on the
    // page behind "자세히 보기"
    expect(
      screen.queryByRole('button', { name: /show original|show translation/ }),
    ).not.toBeInTheDocument()
  })

  test('falls back to the original caption when translation is unavailable', async () => {
    open(0, [momentFixture('a', { source_lang: 'nl' })], {
      translateImpl: async () => null,
    })
    // settle(), not a microtask flush: the call has to actually happen and come
    // back null for this to be a fallback test rather than a first-paint test
    await settle()
    expect(screen.getByText('caption-a')).toBeInTheDocument()
  })

  test('skips the translate round-trip when the caption is already in the viewer language', async () => {
    const translateImpl = vi.fn(async () => '번역됨')
    // the test provider renders under locale 'en'; source_lang 'en' → no fetch
    open(0, [momentFixture('a', { source_lang: 'en' })], { translateImpl })
    await settle()
    expect(translateImpl).not.toHaveBeenCalled()
    expect(screen.getByText('caption-a')).toBeInTheDocument()
  })

  // ←/→ remounts the caption per moment, so translating on mount bought — and
  // permanently cached — a translation for every photo flipped past unread
  // (docs/00 D46). Only the moment the viewer settles on may cost a call.
  test('flipping past moments buys no translation; settling on one does', async () => {
    const translateImpl = vi.fn(async () => '번역됨')
    const moments = ['a', 'b', 'c'].map((id) => momentFixture(id, { source_lang: 'nl' }))
    const view = (openId: string) => (
      <Lightbox
        moments={moments}
        openId={openId}
        onClose={vi.fn()}
        onNavigate={vi.fn()}
        translateImpl={translateImpl}
        translateDelayMs={300}
      />
    )
    const { rerender } = renderWithIntl(view('a'))
    // A macrotask boundary between presses, not a microtask one: a zero-length
    // window would fire inside it, so "the window is too short" fails here just
    // as loudly as "there is no window". Real time is kept out of the flip so a
    // stalled CI runner can't manufacture a 300ms gap and fail correct code.
    await settle()
    rerender(withIntl(view('b')))
    await settle()
    rerender(withIntl(view('c')))
    // a and b were left inside the debounce window — neither was ever bought
    expect(translateImpl).not.toHaveBeenCalled()
    // and the moment actually being read still translates on its own
    expect(await screen.findByText('번역됨')).toBeInTheDocument()
    expect(translateImpl).toHaveBeenCalledTimes(1)
    expect(translateImpl).toHaveBeenCalledWith('c', 'en')
  })

  // The caption is keyed per moment, so stepping back to a photo already read
  // remounts it with empty state. Without a modal-lifetime memo that re-buys
  // the round-trip the debounce exists to save (docs/00 D46).
  test('stepping back to an already-translated moment does not re-buy it', async () => {
    const translateImpl = vi.fn(async (id: string) => `번역-${id}`)
    const moments = ['a', 'b'].map((id) => momentFixture(id, { source_lang: 'nl' }))
    const view = (openId: string) => (
      <Lightbox
        moments={moments}
        openId={openId}
        onClose={vi.fn()}
        onNavigate={vi.fn()}
        translateImpl={translateImpl}
        translateDelayMs={0}
      />
    )
    const { rerender } = renderWithIntl(view('a'))
    expect(await screen.findByText('번역-a')).toBeInTheDocument()
    rerender(withIntl(view('b')))
    expect(await screen.findByText('번역-b')).toBeInTheDocument()

    rerender(withIntl(view('a')))
    // FIRST frame, no await: the answer was already in hand, so re-flashing the
    // original for another debounce window would be a regression of its own
    expect(screen.getByText('번역-a')).toBeInTheDocument()
    // a and b, once each — the return trip was served from the open modal
    expect(translateImpl).toHaveBeenCalledTimes(2)
  })

  // Every other translation test injects a window, so nothing pinned the one
  // that actually ships — TRANSLATE_DEBOUNCE_MS could be deleted or zeroed and
  // the suite would stay green while D46 silently reverted in production.
  test('the shipped default window is long enough to swallow a flip', async () => {
    const translateImpl = vi.fn(async () => '번역됨')
    // undefined, so the prop default — the production constant — applies,
    // overriding the 0 that `open()` seeds for the what-it-renders tests
    open(0, [momentFixture('a', { source_lang: 'nl' })], {
      translateImpl,
      translateDelayMs: undefined,
    })
    await settle()
    expect(translateImpl).not.toHaveBeenCalled()
    // and it does eventually translate — a window that never fires is not a win
    expect(await screen.findByText('번역됨', undefined, { timeout: 2000 })).toBeInTheDocument()
  })

  // The cache deletes a failed entry on purpose. Without that a single 500
  // while the viewer settles pins a null-resolving promise for the whole modal
  // session: every later settle returns it instantly and that caption can never
  // translate again until the modal is closed and reopened.
  test('a failed translation is not cached — the next settle retries it', async () => {
    const translateImpl = vi
      .fn<TranslateImpl>()
      .mockResolvedValueOnce(null) // the round-trip that fails
      .mockResolvedValue('번역됨')
    const moments = ['a', 'b'].map((id) => momentFixture(id, { source_lang: 'nl' }))
    const view = (openId: string) => (
      <Lightbox
        moments={moments}
        openId={openId}
        onClose={vi.fn()}
        onNavigate={vi.fn()}
        translateImpl={translateImpl}
        translateDelayMs={0}
      />
    )
    const { rerender } = renderWithIntl(view('a'))
    await settle()
    expect(screen.getByText('caption-a')).toBeInTheDocument() // original stands

    rerender(withIntl(view('b')))
    await settle()
    rerender(withIntl(view('a')))
    // the retry is allowed to happen, and this time it lands
    expect(await screen.findByText('번역됨')).toBeInTheDocument()
  })

  test('the caption is clamped to a teaser, not shown in full', () => {
    open(0, [momentFixture('a')])
    // line-clamp keeps the modal a preview; the full text is on /m/[id]
    expect(screen.getByText('caption-a').className).toContain('line-clamp-3')
  })

  test('links the uploader Instagram handle when present', () => {
    open(0, [
      momentFixture('a', { author_name: 'raver', author_link: 'https://instagram.com/raver' }),
    ])
    expect(screen.getByRole('link', { name: /Instagram @raver/ })).toHaveAttribute(
      'href',
      'https://instagram.com/raver',
    )
  })

  test('prev is disabled at the first moment; next moves forward', async () => {
    const user = userEvent.setup()
    const { onNavigate } = open(0)
    expect(screen.getByRole('button', { name: 'previous' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'next' }))
    expect(onNavigate).toHaveBeenCalledWith('b')
  })

  test('next is disabled at the last moment', () => {
    open(1) // last of two
    expect(screen.getByRole('button', { name: 'next' })).toBeDisabled()
  })

  // T2.7 keyboard nav — a separate code path from the buttons (window keydown +
  // the prev()/next() boundary guards), so it needs its own coverage.
  test('arrow keys navigate and respect the boundaries', async () => {
    const user = userEvent.setup()
    const { onNavigate } = open(0)
    await user.keyboard('{ArrowLeft}') // at the first moment — guarded, no move
    expect(onNavigate).not.toHaveBeenCalled()
    await user.keyboard('{ArrowRight}')
    expect(onNavigate).toHaveBeenCalledWith('b')
  })

  test('ArrowLeft from a later moment steps back', async () => {
    const user = userEvent.setup()
    const { onNavigate } = open(1)
    await user.keyboard('{ArrowLeft}')
    expect(onNavigate).toHaveBeenCalledWith('a')
    await user.keyboard('{ArrowRight}') // at the last moment — guarded, no move
    expect(onNavigate).toHaveBeenCalledTimes(1)
  })

  // The modal owns the "open by id" guarantee (docs/00 D33) so no host has to
  // re-implement an index adapter: the list moving underneath must not shift the
  // view onto a different photo.
  test('resolves the open moment against the current list, so a prepend cannot shift it', () => {
    const moments = [momentFixture('a'), momentFixture('b')]
    const { rerender } = renderWithIntl(
      <Lightbox
        moments={moments}
        openId="a"
        onClose={vi.fn()}
        onNavigate={vi.fn()}
        translateImpl={async () => null}
      />,
    )
    expect(screen.getByText('caption-a')).toBeInTheDocument()

    rerender(
      withIntl(
        <Lightbox
          moments={[momentFixture('fresh'), ...moments]}
          openId="a"
          onClose={vi.fn()}
          onNavigate={vi.fn()}
          translateImpl={async () => null}
        />,
      ),
    )
    expect(screen.getByText('caption-a')).toBeInTheDocument()
    expect(screen.queryByText('caption-fresh')).not.toBeInTheDocument()
  })

  test('an open moment that leaves the list closes the modal instead of hanging open', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onNavigate = vi.fn()
    const { rerender } = renderWithIntl(
      <Lightbox
        moments={[momentFixture('a'), momentFixture('b')]}
        openId="gone"
        onClose={onClose}
        onNavigate={onNavigate}
        translateImpl={async () => null}
      />,
    )
    // nothing rendered — and the host is told, so it can drop its open id
    // (otherwise the modal stays mounted, keeping the key handler and the
    // stranded focus, with the host still thinking a moment is open)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    // exactly once — the host passes a fresh `onClose` identity every render,
    // so an unlatched effect would re-fire for as long as it stays mounted
    expect(onClose).toHaveBeenCalledTimes(1)
    // still once after a re-render that hands us a fresh onClose identity
    rerender(
      withIntl(
        <Lightbox
          moments={[momentFixture('a'), momentFixture('b')]}
          openId="gone"
          onClose={() => onClose()}
          onNavigate={onNavigate}
          translateImpl={async () => null}
        />,
      ),
    )
    expect(onClose).toHaveBeenCalledTimes(1)

    // and no keyboard navigation escapes from the unresolved state
    await user.keyboard('{ArrowRight}')
    await user.keyboard('{ArrowLeft}')
    expect(onNavigate).not.toHaveBeenCalled()
  })

  test('Escape closes the modal', async () => {
    const user = userEvent.setup()
    const { onClose } = open(0)
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })

  test('a click on the content panel does not close; the backdrop does', async () => {
    const user = userEvent.setup()
    const { onClose } = open(0)
    // clicking the caption (inside the panel) must not bubble to the backdrop —
    // this only proves stopPropagation because the backdrop click below DOES close
    await user.click(screen.getByText('caption-a'))
    expect(onClose).not.toHaveBeenCalled()
    // clicking the image must not close either (its own stopPropagation)
    await user.click(screen.getByAltText('caption-a'))
    expect(onClose).not.toHaveBeenCalled()
    // clicking the backdrop itself closes
    await user.click(screen.getByRole('dialog'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  test('the close button closes', async () => {
    const user = userEvent.setup()
    const { onClose } = open(0)
    await user.click(screen.getByRole('button', { name: 'close' }))
    expect(onClose).toHaveBeenCalled()
  })
})
