'use client'

import { useTranslations } from 'next-intl'
import { useEffect, useRef, useState } from 'react'
import { passportAuthErrorCode, type PassportAuthErrorCode } from '@/lib/passport/backend'
import { inputClass } from './ui'

/**
 * Shared two-step email OTP form (docs/15 §4, D16) — used for both linking
 * an email to the current passport and signing in on another device. Codes
 * instead of magic links: the user never leaves this browser tab, so the
 * mobile "link opened in the wrong browser" trap can't happen.
 */

const ERROR_KEYS: Record<PassportAuthErrorCode, string> = {
  'email-in-use': 'emailInUse',
  'no-passport': 'noPassport',
  'bad-code': 'badCode',
  'rate-limited': 'rateLimited',
  unknown: 'genericError',
}

const RESEND_COOLDOWN_MS = 60_000

export function EmailOtpForm({
  send,
  verify,
}: {
  send: (email: string) => Promise<void>
  verify: (email: string, code: string) => Promise<void>
}) {
  const t = useTranslations('passport')
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [errorKey, setErrorKey] = useState<string | null>(null)
  const [canResend, setCanResend] = useState(false)
  const resendTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => () => clearTimeout(resendTimer.current), [])

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setErrorKey(null)
    try {
      await action()
    } catch (error) {
      setErrorKey(ERROR_KEYS[passportAuthErrorCode(error)])
    } finally {
      setBusy(false)
    }
  }

  async function sendCode() {
    await run(async () => {
      await send(email.trim())
      setStep('code')
      setCanResend(false)
      clearTimeout(resendTimer.current)
      resendTimer.current = setTimeout(() => setCanResend(true), RESEND_COOLDOWN_MS)
    })
  }

  if (step === 'email') {
    return (
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          void sendCode()
        }}
      >
        <input
          type="email"
          required
          value={email}
          aria-label={t('emailPlaceholder')}
          placeholder={t('emailPlaceholder')}
          onChange={(e) => setEmail(e.target.value)}
          className={inputClass}
        />
        {errorKey && <p className="text-sm text-red">{t(errorKey)}</p>}
        <button
          type="submit"
          disabled={busy || !email.trim()}
          className="self-start rounded-full bg-orange px-5 py-2 text-sm font-medium text-black disabled:opacity-50"
        >
          {t('sendCode')}
        </button>
      </form>
    )
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        void run(() => verify(email.trim(), code.trim()))
      }}
    >
      <p className="text-sm text-muted">{t('codeSent', { email: email.trim() })}</p>
      <input
        inputMode="numeric"
        autoComplete="one-time-code"
        required
        value={code}
        aria-label={t('codePlaceholder')}
        placeholder={t('codePlaceholder')}
        onChange={(e) => setCode(e.target.value)}
        className={inputClass}
      />
      {errorKey && <p className="text-sm text-red">{t(errorKey)}</p>}
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={busy || !code.trim()}
          className="rounded-full bg-orange px-5 py-2 text-sm font-medium text-black disabled:opacity-50"
        >
          {t('verifyCode')}
        </button>
        <button
          type="button"
          disabled={busy || !canResend}
          onClick={() => void sendCode()}
          className="text-sm text-muted disabled:opacity-50 hover:text-paper"
        >
          {t('resendCode')}
        </button>
      </div>
    </form>
  )
}
