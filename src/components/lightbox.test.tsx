import { screen } from '@testing-library/react'
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

function open(index: number, moments = [momentFixture('a'), momentFixture('b')], extra = {}) {
  const onClose = vi.fn()
  const onNavigate = vi.fn()
  renderWithIntl(
    <Lightbox
      moments={moments}
      index={index}
      editionById={editionById}
      onClose={onClose}
      onNavigate={onNavigate}
      translateImpl={async () => null}
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
    expect(onNavigate).toHaveBeenCalledWith(1)
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
    expect(onNavigate).toHaveBeenCalledWith(1)
  })

  test('ArrowLeft from a later moment steps back', async () => {
    const user = userEvent.setup()
    const { onNavigate } = open(1)
    await user.keyboard('{ArrowLeft}')
    expect(onNavigate).toHaveBeenCalledWith(0)
    await user.keyboard('{ArrowRight}') // at the last moment — guarded, no move
    expect(onNavigate).toHaveBeenCalledTimes(1)
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
