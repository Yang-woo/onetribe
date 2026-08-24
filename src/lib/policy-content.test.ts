import { describe, expect, test } from 'vitest'
import { POLICIES, POLICY_CONTACT_EMAIL, POLICY_LAST_UPDATED, SITE_DOMAIN } from './policy-content'

/**
 * docs/10 checklist guard: the published contact must be the domain inbox.
 * The policies e2e only catches [BRACKET] placeholders — a valid-looking
 * personal gmail would sail through it, so this pins the domain itself.
 */
describe('policy constants', () => {
  test('site domain and contact inbox are pinned to onetribe.world (D14)', () => {
    expect(SITE_DOMAIN).toBe('onetribe.world')
    expect(POLICY_CONTACT_EMAIL).toBe(`privacy@${SITE_DOMAIN}`)
  })

  test('last-updated is a plausible ISO date', () => {
    expect(POLICY_LAST_UPDATED).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

/**
 * docs/00 D54 gave uploaders a second way out — the moment's own modal in the
 * passport — and the policy copy kept describing only the first. The person who
 * needs this page is precisely the one who lost their deletion link, so both
 * routes have to survive here: the passport for attributed uploads, the link
 * for the ones made without an account, which the passport cannot reach.
 */
describe('takedown copy names every route out (D54)', () => {
  const takedown = POLICIES.takedown.sections.flatMap((s) => s.paragraphs).join(' ')
  const ownContent = POLICIES.terms.sections[1].paragraphs.join(' ')
  const rights = POLICIES.privacy.sections[3].paragraphs.join(' ')

  test.each([
    ['takedown', takedown],
    ['terms §2', ownContent],
    ['privacy §4', rights],
  ])('%s offers the passport', (_name, text) => {
    expect(text).toMatch(/Passport/)
  })

  test('the deletion link stays on offer — the passport cannot reach an unattributed upload', () => {
    expect(takedown).toMatch(/deletion link/)
    expect(ownContent).toMatch(/deletion link/)
  })
})
