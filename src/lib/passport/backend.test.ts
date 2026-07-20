import { describe, expect, test } from 'vitest'
import { passportAuthErrorCode } from './backend'

/**
 * GoTrue error-code → UI bucket mapping (D16). The buckets drive which
 * i18n message the passport forms show, so every code the flows can
 * produce must land somewhere sensible.
 */
describe('passportAuthErrorCode', () => {
  test.each([
    ['email_exists', 'emailInUse'],
    ['identity_already_exists', 'googleInUse'], // only linkIdentity raises this
    ['otp_disabled', 'noPassport'], // shouldCreateUser:false + unknown email
    ['otp_expired', 'badCode'],
    ['over_email_send_rate_limit', 'rateLimited'],
    ['over_request_rate_limit', 'rateLimited'],
  ] as const)('%s → %s', (code, expected) => {
    expect(passportAuthErrorCode({ code })).toBe(expected)
  })

  test('anything unrecognized falls back to the generic message', () => {
    expect(passportAuthErrorCode({ code: 'brand_new_code' })).toBe('genericError')
    expect(passportAuthErrorCode(new Error('network down'))).toBe('genericError')
    expect(passportAuthErrorCode(null)).toBe('genericError')
    expect(passportAuthErrorCode('nope')).toBe('genericError')
  })
})
