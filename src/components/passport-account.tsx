'use client'

import { useLocale, useTranslations } from 'next-intl'
import { useState } from 'react'
import {
  GOOGLE_AUTH_ENABLED,
  passportReturnUrl,
  type PassportBackend,
  type PassportIdentity,
  type PassportState,
} from '@/lib/passport/backend'
import { EmailOtpForm } from './email-otp-form'
import { secondaryButtonClass } from './ui'

/**
 * Passport account section (docs/15 §4, D16). Anonymous passports get the
 * "keep this passport" upgrade (email OTP / Google link — same user id, so
 * stamps and moments carry over); upgraded ones show what's connected plus
 * sign-out and GDPR self-serve deletion.
 */

export function PassportAccount({
  identity,
  api,
  onIdentity,
  onState,
  googleEnabled = GOOGLE_AUTH_ENABLED,
}: {
  identity: PassportIdentity
  api: PassportBackend
  /** A link upgraded this passport in place — merge the fresh identity. */
  onIdentity: (identity: PassportIdentity) => void
  /** The session itself changed — signed into another passport (state) or out (null). */
  onState: (state: PassportState | null) => void
  googleEnabled?: boolean
}) {
  const t = useTranslations('passport')
  const locale = useLocale()
  const [panel, setPanel] = useState<'none' | 'link-email' | 'sign-in'>('none')
  const [busy, setBusy] = useState(false)
  const [errorKey, setErrorKey] = useState<'genericError' | null>(null)

  // signOut/deleteAccount both end this device's session — same rail.
  const endSession = (action: () => Promise<void>) => {
    setBusy(true)
    setErrorKey(null)
    void action()
      .then(() => onState(null))
      .catch(() => setErrorKey('genericError'))
      .finally(() => setBusy(false))
  }
  // OAuth navigates away on success — busy only resets on failure.
  const oauth = (start: (redirectTo: string) => Promise<void>) => {
    setBusy(true)
    void start(passportReturnUrl(locale)).catch(() => setBusy(false))
  }

  if (identity.isAnonymous) {
    return (
      <section className="flex flex-col gap-3 border-t border-line pt-6">
        <h3 className="font-display lowercase">{t('keepTitle')}</h3>
        <p className="text-sm text-muted">{t('keepHint')}</p>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => setPanel(panel === 'link-email' ? 'none' : 'link-email')}
            className={secondaryButtonClass}
          >
            {t('connectEmail')}
          </button>
          {googleEnabled && (
            <button
              type="button"
              disabled={busy}
              onClick={() => oauth(api.linkGoogle)}
              className={secondaryButtonClass}
            >
              {t('connectGoogle')}
            </button>
          )}
        </div>
        {panel === 'link-email' && (
          <EmailOtpForm
            send={(email) => api.linkEmailStart(email)}
            verify={async (email, code) => {
              onIdentity(await api.linkEmailVerify(email, code))
            }}
          />
        )}
        {/* already upgraded elsewhere? switching replaces this device's session —
            stamps made on this anonymous passport stay behind (no merge, D16) */}
        {panel !== 'sign-in' ? (
          <button
            type="button"
            onClick={() => {
              if (window.confirm(t('switchWarning'))) setPanel('sign-in')
            }}
            className="self-start text-sm text-muted underline-offset-2 hover:text-paper hover:underline"
          >
            {t('signInTitle')}
          </button>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted">{t('signInHint')}</p>
            <EmailOtpForm
              send={(email) => api.signInEmailStart(email)}
              verify={async (email, code) => {
                onState(await api.signInEmailVerify(email, code))
              }}
            />
            {googleEnabled && (
              <button
                type="button"
                disabled={busy}
                onClick={() => oauth(api.signInGoogle)}
                className={`self-start ${secondaryButtonClass}`}
              >
                {t('connectGoogle')}
              </button>
            )}
          </div>
        )}
      </section>
    )
  }

  const connectedLabel = identity.email
    ? t('linkedAs', { email: identity.email })
    : identity.providers.includes('google')
      ? t('linkedGoogle')
      : null

  return (
    <section className="flex flex-col gap-3 border-t border-line pt-6">
      <h3 className="font-display lowercase">{t('keepTitle')}</h3>
      {connectedLabel && <p className="text-sm text-orange">{connectedLabel}</p>}
      <p className="text-sm text-muted">{t('otherDeviceHint')}</p>
      {errorKey && (
        <p role="alert" className="text-sm text-red">
          {t(errorKey)}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => endSession(() => api.signOut())}
          className={secondaryButtonClass}
        >
          {t('signOut')}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (!window.confirm(t('deleteConfirm'))) return
            endSession(() => api.deleteAccount())
          }}
          className="rounded-full border border-red/45 px-4 py-2 text-sm text-red/80 transition-colors hover:border-red hover:text-red disabled:opacity-50"
        >
          {t('deleteAccount')}
        </button>
      </div>
    </section>
  )
}
