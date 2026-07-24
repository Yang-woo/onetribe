import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import type { EditionChip } from '@/lib/moments'
import { momentFixture, renderWithIntl } from '@/test-utils'
import { MomentThumb } from './moment-thumb'

// Spec: docs/15 §1 + wall UX pass — the image opens the moment modal, while the
// @handle is a SEPARATE Instagram link (distinct hit areas), and the passport
// reuses the card inert (no onOpen).

const ed: EditionChip = {
  id: 'event-1',
  year: 2024,
  edition: 'Power of the Tribe',
  canceled: false,
}

describe('MomentThumb', () => {
  test('the image is a button that opens the moment (onOpen), named by the caption', async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    renderWithIntl(<MomentThumb moment={momentFixture('a')} onOpen={onOpen} />)

    await user.click(screen.getByRole('button', { name: 'caption-a' }))
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  test('the display name is a separate Instagram link — not inside the open trigger', () => {
    renderWithIntl(
      <MomentThumb
        moment={momentFixture('a', {
          author_name: 'raver',
          author_link: 'https://instagram.com/raver',
        })}
        onOpen={() => {}}
      />,
    )

    // the name is shown (no @ on the display name); the @ lives on the handle in
    // the link's accessible name (docs/00 D30)
    const link = screen.getByRole('link', { name: /Instagram @raver/ })
    expect(link).toHaveAttribute('href', 'https://instagram.com/raver')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveTextContent('raver')
    expect(link).not.toHaveTextContent('@raver')
    // distinct hit area: the link must not be nested in the open button (an <a>
    // inside a <button> would be invalid and would swallow the Instagram click).
    expect(screen.getByRole('button', { name: 'caption-a' }).contains(link)).toBe(false)
  })

  test('the display name is plain text when the uploader gave no handle', () => {
    renderWithIntl(
      <MomentThumb
        moment={momentFixture('a', { author_name: 'raver', author_link: null })}
        onOpen={() => {}}
      />,
    )
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByText('raver')).toBeInTheDocument()
  })

  test('carries the edition tag (year + anthem initials)', () => {
    renderWithIntl(<MomentThumb moment={momentFixture('a')} edition={ed} onOpen={() => {}} />)
    expect(screen.getByText('2024 POTT')).toBeInTheDocument()
  })

  test('reserves the stored aspect ratio on the image (zero-shift skeleton, D32)', () => {
    renderWithIntl(
      <MomentThumb moment={momentFixture('a', { aspect_ratio: 0.75 })} onOpen={() => {}} />,
    )
    // jsdom serializes the ratio as "0.75 / 1" — assert on the value
    expect(screen.getByAltText('caption-a').style.aspectRatio).toMatch(/0\.75/)
  })

  test('without onOpen (passport) the card is inert — no button', () => {
    renderWithIntl(<MomentThumb moment={momentFixture('a')} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByText('caption-a')).toBeInTheDocument()
  })
})
