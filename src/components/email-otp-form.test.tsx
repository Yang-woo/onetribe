import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { renderWithIntl } from '@/test-utils'
import { EmailOtpForm } from './email-otp-form'

/**
 * Two-step email OTP form (docs/15 §4, D16) — send a code, then verify it.
 * Error buckets from the backend map to human messages; the resend button
 * starts cooled down so users can't hammer the mail rate limit.
 */

describe('EmailOtpForm', () => {
  test('email → code: send is called and the form advances', async () => {
    const user = userEvent.setup()
    const send = vi.fn().mockResolvedValue(undefined)
    const verify = vi.fn().mockResolvedValue(undefined)
    renderWithIntl(<EmailOtpForm send={send} verify={verify} />)

    await user.type(screen.getByLabelText('your email'), 'raver@example.com')
    await user.click(screen.getByRole('button', { name: 'send me a code' }))

    expect(send).toHaveBeenCalledWith('raver@example.com')
    expect(await screen.findByText('we sent a code to raver@example.com')).toBeInTheDocument()
    // resend starts on cooldown — no instant re-sends
    expect(screen.getByRole('button', { name: 'send it again' })).toBeDisabled()
  })

  test('verifying the code passes email + code through', async () => {
    const user = userEvent.setup()
    const send = vi.fn().mockResolvedValue(undefined)
    const verify = vi.fn().mockResolvedValue(undefined)
    renderWithIntl(<EmailOtpForm send={send} verify={verify} />)

    await user.type(screen.getByLabelText('your email'), 'raver@example.com')
    await user.click(screen.getByRole('button', { name: 'send me a code' }))
    await user.type(await screen.findByLabelText('6-digit code'), '123456')
    await user.click(screen.getByRole('button', { name: 'confirm' }))

    expect(verify).toHaveBeenCalledWith('raver@example.com', '123456')
  })

  test('send failing with a rate-limit code keeps the email step and explains', async () => {
    const user = userEvent.setup()
    const send = vi.fn().mockRejectedValue({ code: 'over_email_send_rate_limit' })
    renderWithIntl(<EmailOtpForm send={send} verify={vi.fn()} />)

    await user.type(screen.getByLabelText('your email'), 'raver@example.com')
    await user.click(screen.getByRole('button', { name: 'send me a code' }))

    expect(await screen.findByText('too many emails — try again in a minute')).toBeInTheDocument()
    // still on the email step
    expect(screen.getByLabelText('your email')).toBeInTheDocument()
  })

  test('sign-in for an unknown email surfaces the no-passport message', async () => {
    const user = userEvent.setup()
    const send = vi.fn().mockRejectedValue({ code: 'otp_disabled' })
    renderWithIntl(<EmailOtpForm send={send} verify={vi.fn()} />)

    await user.type(screen.getByLabelText('your email'), 'ghost@example.com')
    await user.click(screen.getByRole('button', { name: 'send me a code' }))

    expect(await screen.findByText('no passport found for this email')).toBeInTheDocument()
  })

  test('a wrong/expired code shows the bad-code message and allows retry', async () => {
    const user = userEvent.setup()
    const send = vi.fn().mockResolvedValue(undefined)
    const verify = vi.fn().mockRejectedValue({ code: 'otp_expired' })
    renderWithIntl(<EmailOtpForm send={send} verify={verify} />)

    await user.type(screen.getByLabelText('your email'), 'raver@example.com')
    await user.click(screen.getByRole('button', { name: 'send me a code' }))
    await user.type(await screen.findByLabelText('6-digit code'), '000000')
    await user.click(screen.getByRole('button', { name: 'confirm' }))

    expect(
      await screen.findByText("that code didn't work — check it and try again"),
    ).toBeInTheDocument()
    // the code input stays for a corrected retry
    expect(screen.getByLabelText('6-digit code')).toBeInTheDocument()
  })
})
