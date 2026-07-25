import { afterEach, describe, expect, test } from 'vitest'
import { adminEmailsFromEnv } from './admin'

// The env half of the operator gates — this parse is what makes both the
// admin console (requireAdmin) and the account-delete guard case-insensitive
// end to end, so it gets pinned directly.
describe('adminEmailsFromEnv', () => {
  const original = process.env.ADMIN_EMAILS
  afterEach(() => {
    if (original === undefined) delete process.env.ADMIN_EMAILS
    else process.env.ADMIN_EMAILS = original
  })

  test('splits on commas, trims and lowercases entries', () => {
    process.env.ADMIN_EMAILS = ' Op@OneTribe.World ,second@Example.com '
    expect(adminEmailsFromEnv()).toEqual(['op@onetribe.world', 'second@example.com'])
  })

  test('unset or blank env yields an inert empty list', () => {
    delete process.env.ADMIN_EMAILS
    expect(adminEmailsFromEnv()).toEqual([])
    process.env.ADMIN_EMAILS = ' , '
    expect(adminEmailsFromEnv()).toEqual([])
  })
})
