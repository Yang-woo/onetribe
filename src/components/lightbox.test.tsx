import { screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import messages from '../../messages/en.json'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import type { EditionChip } from '@/lib/moments'
import { momentFixture, renderWithIntl } from '@/test-utils'
import { Lightbox } from './lightbox'

// Spec: docs/15 §1 + wall UX pass — tapping a card opens the moment IN the
// modal (caption, edition, Instagram) with a clear "view details ↗" permalink;
// Esc / backdrop close, a click on the content panel does not.

const editionById = new Map<string, EditionChip>([
  ['event-1', { id: 'event-1', year: 2024, edition: 'Power of the Tribe', canceled: false }],
])

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
    await Promise.resolve()
    expect(screen.getByText('caption-a')).toBeInTheDocument()
  })

  test('skips the translate round-trip when the caption is already in the viewer language', async () => {
    const translateImpl = vi.fn(async () => '번역됨')
    // the test provider renders under locale 'en'; source_lang 'en' → no fetch
    open(0, [momentFixture('a', { source_lang: 'en' })], { translateImpl })
    await Promise.resolve()
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
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <Lightbox
          moments={moments}
          openId={openId}
          onClose={vi.fn()}
          onNavigate={vi.fn()}
          translateImpl={translateImpl}
          translateDelayMs={300}
        />
      </NextIntlClientProvider>
    )
    const { rerender } = renderWithIntl(
      <Lightbox
        moments={moments}
        openId="a"
        onClose={vi.fn()}
        onNavigate={vi.fn()}
        translateImpl={translateImpl}
        translateDelayMs={300}
      />,
    )
    // real elapsed time between presses, so a window too short to cover an
    // arrow-key flip fails here just as loudly as no window at all
    await new Promise((resolve) => setTimeout(resolve, 20))
    rerender(view('b'))
    await new Promise((resolve) => setTimeout(resolve, 20))
    rerender(view('c'))
    // a and b were left inside the debounce window — neither was ever bought
    expect(translateImpl).not.toHaveBeenCalled()
    // and the moment actually being read still translates on its own
    expect(await screen.findByText('번역됨')).toBeInTheDocument()
    expect(translateImpl).toHaveBeenCalledTimes(1)
    expect(translateImpl).toHaveBeenCalledWith('c', 'en')
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
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <Lightbox
          moments={[momentFixture('fresh'), ...moments]}
          openId="a"
          onClose={vi.fn()}
          onNavigate={vi.fn()}
          translateImpl={async () => null}
        />
      </NextIntlClientProvider>,
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
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <Lightbox
          moments={[momentFixture('a'), momentFixture('b')]}
          openId="gone"
          onClose={() => onClose()}
          onNavigate={onNavigate}
          translateImpl={async () => null}
        />
      </NextIntlClientProvider>,
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
