import { describe, expect, test } from 'vitest'
import { passportAuthErrorCode } from './backend'

/**
 * GoTrue error-code → UI bucket mapping (D16). The buckets drive which
 * i18n message the passport forms show, so every code the flows can
 * produce must land somewhere sensible.
 */
describe('passportAuthErrorCode', () => {
  test.each([
    ['email_exists', 'email-in-use'],
    ['identity_already_exists', 'email-in-use'],
    ['otp_disabled', 'no-passport'], // shouldCreateUser:false + unknown email
    ['otp_expired', 'bad-code'],
    ['over_email_send_rate_limit', 'rate-limited'],
    ['over_request_rate_limit', 'rate-limited'],
  ] as const)('%s → %s', (code, expected) => {
    expect(passportAuthErrorCode({ code })).toBe(expected)
  })

  test('anything unrecognized falls back to unknown', () => {
    expect(passportAuthErrorCode({ code: 'brand_new_code' })).toBe('unknown')
    expect(passportAuthErrorCode(new Error('network down'))).toBe('unknown')
    expect(passportAuthErrorCode(null)).toBe('unknown')
    expect(passportAuthErrorCode('nope')).toBe('unknown')
  })
})
