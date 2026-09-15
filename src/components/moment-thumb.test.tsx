import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { momentFixture, renderWithIntl } from '@/test-utils'
import { MomentThumb } from './moment-thumb'

// Spec: docs/15 §1 + wall UX pass — the image opens the moment modal, while the
// @handle is a SEPARATE Instagram link (distinct hit areas). The corner tag is
// caller-supplied text: the wall spells the anthem out, the passport shows the year.
// docs/00 D59 — the image is a real link to /m/[id], so crawlers reach moment
// pages from the wall; the modal is a click interception on top of it.

const TAG = '2024 — Power of the Tribe'

describe('MomentThumb', () => {
  test('the image links to the moment page, and a plain click opens the modal in place', () => {
    const onOpen = vi.fn()
    renderWithIntl(<MomentThumb moment={momentFixture('a')} onOpen={onOpen} />)

    const link = screen.getByRole('link', { name: 'caption-a' })
    expect(link).toHaveAttribute('href', '/en/m/a')
    // fireEvent returns false when a handler called preventDefault — the wall
    // must not navigate away underneath the modal it just opened
    expect(fireEvent.click(link)).toBe(false)
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  test('a modified click keeps the browser default — a new tab, no modal', () => {
    const onOpen = vi.fn()
    renderWithIntl(<MomentThumb moment={momentFixture('a')} onOpen={onOpen} />)
    const link = screen.getByRole('link', { name: 'caption-a' })

    for (const modifier of ['metaKey', 'ctrlKey', 'shiftKey', 'altKey'] as const) {
      // prevented would be false: the href is what a cmd-click opens
      expect(fireEvent.click(link, { [modifier]: true })).toBe(true)
    }
    expect(onOpen).not.toHaveBeenCalled()
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
    // distinct hit area: nested links are invalid HTML, and the outer one would
    // swallow the Instagram click.
    expect(screen.getByRole('link', { name: 'caption-a' }).contains(link)).toBe(false)
  })

  test('the display name is plain text when the uploader gave no handle', () => {
    renderWithIntl(
      <MomentThumb
        moment={momentFixture('a', { author_name: 'raver', author_link: null })}
        onOpen={() => {}}
      />,
    )
    expect(screen.queryByRole('link', { name: /Instagram/ })).not.toBeInTheDocument()
    expect(screen.getByText('raver')).toBeInTheDocument()
  })

  test('no tag → nothing printed over the photo', () => {
    // an unknown event id (a hidden edition year, or an edition the lookup
    // missed) must not stamp an empty chip on the picture
    const { container } = renderWithIntl(
      <MomentThumb moment={momentFixture('a')} onOpen={() => {}} />,
    )
    const imageArea = container.querySelector('figure > div')!
    expect(imageArea.textContent).toBe('')
    // A chip with no text is still a black pill stamped on the photo, and an
    // empty string is invisible to any text query — so this counts boxes: the
    // scrim and the expand glyph, and nothing else.
    expect(imageArea.querySelectorAll(':scope > span')).toHaveLength(2)
  })

  test('renders the tag verbatim, outside the open link (WCAG 2.5.3)', () => {
    renderWithIntl(<MomentThumb moment={momentFixture('a')} tag={TAG} onOpen={() => {}} />)
    // The tag sits OUTSIDE the open link so it never competes with the link's
    // accessible name (the caption) — label-content-name-mismatch. It used to
    // render inside the trigger, dragging the tag into the label.
    const tag = screen.getByText(TAG)
    const trigger = screen.getByRole('link', { name: 'caption-a' })
    expect(trigger.contains(tag)).toBe(false)
  })

  test('reserves the stored aspect ratio on the image (zero-shift skeleton, D32)', () => {
    renderWithIntl(
      <MomentThumb moment={momentFixture('a', { aspect_ratio: 0.75 })} onOpen={() => {}} />,
    )
    // jsdom serializes the ratio as "0.75 / 1" — assert on the value
    expect(screen.getByAltText('caption-a').style.aspectRatio).toMatch(/0\.75/)
  })
})
