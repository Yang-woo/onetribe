import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithIntl } from '@/test-utils'
import { describe, expect, test, vi } from 'vitest'
import { FOOTER_LINKS } from '@/lib/site-links'
import { SiteInfoFab } from './site-info-fab'

// The live rail is a deploy-time constant (D15), so the only way to exercise
// the "no rail yet" branch is to stand in for it.
const rail = vi.hoisted(() => ({ live: true }))
vi.mock('@/lib/support', () => ({ hasSupportLinks: () => rail.live }))

// docs/00 D51 — the wall auto-loads, so the footer is below a bottom that
// moves away as you approach it. This button is the policy links' only
// dependable entry point on that page, so what it must never do is lose one,
// strand itself open, or point at a donation rail that isn't live.

describe('SiteInfoFab', () => {
  test('collapsed by default — the links are not reachable until asked for', () => {
    renderWithIntl(<SiteInfoFab />)

    expect(screen.getByRole('button', { name: 'site info' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  test('opening it exposes every footer link, locale-prefixed, plus the disclaimer', async () => {
    const user = userEvent.setup()
    renderWithIntl(<SiteInfoFab />)

    await user.click(screen.getByRole('button', { name: 'site info' }))

    // Parity with the footer's set is the whole point of the shared list: a
    // link added to one and not the other is a link the wall page can't reach.
    const labels: Record<(typeof FOOTER_LINKS)[number], string> = {
      terms: 'terms',
      privacy: 'privacy',
      takedown: 'removals',
      guidelines: 'guidelines',
      about: 'about',
    }
    for (const key of FOOTER_LINKS) {
      expect(screen.getByRole('link', { name: labels[key] })).toHaveAttribute('href', `/en/${key}`)
    }
    expect(screen.getByText(/Unofficial fan project/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'site info' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
  })

  test('the donation link enters through About, and only while a rail is live', async () => {
    const user = userEvent.setup()
    const { unmount } = renderWithIntl(<SiteInfoFab />)
    await user.click(screen.getByRole('button', { name: 'site info' }))
    // D15: never a direct external link — the no-perk framing comes first.
    expect(screen.getByRole('link', { name: 'support' })).toHaveAttribute(
      'href',
      '/en/about#support',
    )
    unmount()

    // A rail that isn't open yet must not ship a dead link (D15).
    rail.live = false
    try {
      renderWithIntl(<SiteInfoFab />)
      await user.click(screen.getByRole('button', { name: 'site info' }))
      expect(screen.queryByRole('link', { name: 'support' })).not.toBeInTheDocument()
    } finally {
      rail.live = true
    }
  })

  test('Escape closes it and hands focus back to the button', async () => {
    const user = userEvent.setup()
    renderWithIntl(<SiteInfoFab />)
    const button = screen.getByRole('button', { name: 'site info' })

    await user.click(button)
    // Tab into the panel first: that's where a keyboard user is when they
    // give up on it, and it's the only case with anything to restore. Escape
    // from the button itself never moved focus in the first place.
    await user.tab()
    expect(screen.getByRole('link', { name: 'terms' })).toHaveFocus()

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('link', { name: 'about' })).not.toBeInTheDocument()
    // Without the explicit restore, focus falls to <body> and the reader
    // has to tab from the top of the page to get back where they were.
    expect(button).toHaveFocus()
  })

  test('a press outside closes it — the panel has no backdrop to catch it', async () => {
    const user = userEvent.setup()
    renderWithIntl(
      <>
        <button type="button">a photo</button>
        <SiteInfoFab />
      </>,
    )

    await user.click(screen.getByRole('button', { name: 'site info' }))
    expect(screen.getByRole('link', { name: 'about' })).toBeInTheDocument()

    // Without the outside-press listener the panel survives opening a moment
    // and is still sitting there, open, when the modal closes.
    await user.click(screen.getByRole('button', { name: 'a photo' }))
    expect(screen.queryByRole('link', { name: 'about' })).not.toBeInTheDocument()
  })
})
