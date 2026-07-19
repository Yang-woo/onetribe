import { describe, expect, test } from 'vitest'
import { POLICY_CONTACT_EMAIL, POLICY_LAST_UPDATED } from './policy-content'

/**
 * docs/10 checklist guard: the published contact must be the domain inbox.
 * The policies e2e only catches [BRACKET] placeholders — a valid-looking
 * personal gmail would sail through it, so this pins the domain itself.
 */
describe('policy constants', () => {
  test('contact email is the domain inbox, never a personal fallback', () => {
    expect(POLICY_CONTACT_EMAIL.endsWith('@onetribe.world')).toBe(true)
  })

  test('last-updated is a plausible ISO date', () => {
    expect(POLICY_LAST_UPDATED).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
