import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithIntl } from '@/test-utils'
import { describe, expect, test, vi } from 'vitest'
import { SITE_LINKS, SOURCE_LINK } from '@/lib/site-links'
import { SUPPORT_ANCHOR } from '@/lib/support'
import { SiteInfoFab } from './site-info-fab'

// The live rail is a deploy-time constant (D15), so the only way to exercise
// the "no rail yet" branch is to stand in for it. Only the gate is stubbed —
// SUPPORT_ANCHOR stays real, so the href assertions test the shipped value.
const rail = vi.hoisted(() => ({ live: true }))
vi.mock(import('@/lib/support'), async (importOriginal) => ({
  ...(await importOriginal()),
  hasSupportLinks: () => rail.live,
}))

// docs/00 D51 — on the wall page the footer is many screens down, so this is
// the policy links' dependable entry point. What it must never do is lose a
// link, strand itself open, or point at a donation rail that isn't live.

describe('SiteInfoFab', () => {
  test('collapsed by default — the links are not reachable until asked for', () => {
    renderWithIntl(<SiteInfoFab />)

    expect(screen.getByRole('button', { name: 'site info' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  test('opening it exposes every policy link, locale-prefixed and in order', async () => {
    const user = userEvent.setup()
    renderWithIntl(<SiteInfoFab />)

    await user.click(screen.getByRole('button', { name: 'site info' }))

    // Parity with the footer's set is the whole point of the shared list: a
    // link added to one and not the other is a link the wall page can't reach.
    // Asserted by href and in order, so an extra entry — or a renderer that
    // reorders the list — fails too.
    expect(screen.getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual([
      ...SITE_LINKS.map((key) => `/en/${key}`),
      `/en${SUPPORT_ANCHOR}`,
      SOURCE_LINK.url,
    ])
    // ...but that expectation is built from SITE_LINKS, so it follows any
    // reorder rather than failing on one. About being first is a decision
    // (D52 — the one link that says what this site is), so pin it separately.
    expect(screen.getAllByRole('link')[0]).toHaveAccessibleName('about')
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
      `/en${SUPPORT_ANCHOR}`,
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

  test('the source link leaves the site — absolute, new tab, no handle back', async () => {
    const user = userEvent.setup()
    renderWithIntl(<SiteInfoFab />)

    await user.click(screen.getByRole('button', { name: 'site info' }))
    const source = screen.getByRole('link', { name: SOURCE_LINK.label })

    // Rendered through the locale-aware Link like its neighbours, this would
    // ship as /en/https://github.com/... — a 404 that still looks like a link.
    expect(source).toHaveAttribute('href', SOURCE_LINK.url)
    expect(source).toHaveAttribute('target', '_blank')
    // target="_blank" hands the opened tab a window.opener pointing back here;
    // rel is what takes it away. Nothing else in this panel opens a tab, so
    // dropping it here would go unnoticed by every other test.
    expect(source.getAttribute('rel')).toContain('noopener')

    // The mark ships and stays decorative. Two mutations, two assertions:
    // dropping `aria-hidden` is caught by the first (a bare <svg> contributes
    // nothing to the name, so the second survives it alone), and dropping it
    // *and* titling the mark — the way an icon usually earns a name — makes
    // the link announce "GitHub GitHub ↗", which only the second catches.
    expect(source.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    expect(source).toHaveAccessibleName(SOURCE_LINK.label)
  })

  test('an open moment owns Escape — the panel is not collateral', async () => {
    const user = userEvent.setup()
    renderWithIntl(
      <>
        <SiteInfoFab />
        <div role="dialog" aria-modal="true" aria-label="a moment" />
      </>,
    )

    await user.click(screen.getByRole('button', { name: 'site info' }))
    await user.keyboard('{Escape}')

    // The modal's own handler closes the modal; this panel must survive so it
    // is still there when the reader comes back out.
    expect(screen.getByRole('link', { name: 'about' })).toBeInTheDocument()
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
    expect(screen.getByRole('link', { name: 'about' })).toHaveFocus()

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
