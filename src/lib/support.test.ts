import { afterEach, describe, expect, it } from 'vitest'
import { SUPPORT_LINKS, hasSupportLinks } from './support'

/**
 * `hasSupportLinks` gates the whole About #support section and the footer link
 * to it. Both branches matter and neither is covered anywhere else: if it wrongly
 * returns true the site ships a donation button with no destination, and if it
 * wrongly returns false the only donation rail silently disappears (docs/00 D15).
 */
const shipped = { ...SUPPORT_LINKS }
afterEach(() => Object.assign(SUPPORT_LINKS, shipped))

describe('hasSupportLinks', () => {
  it('hides the section when no rail is live', () => {
    Object.assign(SUPPORT_LINKS, { kofi: null, githubSponsors: null })
    expect(hasSupportLinks()).toBe(false)
  })

  it('shows it when only the second rail is live', () => {
    Object.assign(SUPPORT_LINKS, { kofi: null, githubSponsors: 'https://example.test/sponsors' })
    expect(hasSupportLinks()).toBe(true)
  })

  it('still shows it when one rail is emptied to a blank string and another is live', () => {
    Object.assign(SUPPORT_LINKS, { kofi: '', githubSponsors: 'https://example.test/sponsors' })
    expect(hasSupportLinks()).toBe(true)
  })

  it('treats a rail emptied to a blank string as no rail', () => {
    Object.assign(SUPPORT_LINKS, { kofi: '', githubSponsors: null })
    expect(hasSupportLinks()).toBe(false)
  })
})
