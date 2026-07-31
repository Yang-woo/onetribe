'use client'

import { useTranslations } from 'next-intl'
import { useState } from 'react'
import type { PassportBackend, PassportIdentity, PassportState } from '@/lib/passport/backend'
import { EmailOtpForm } from './email-otp-form'
import { secondaryButtonClass } from './ui'

/**
 * Passport account section (docs/15 §4, D16). Anonymous passports get the
 * "keep this passport" upgrade (email OTP — same user id, so stamps and
 * moments carry over); upgraded ones show what's connected plus sign-out and
 * GDPR self-serve deletion. Signing into another passport from here folds this
 * device's anonymous uploads/stamps into it (docs/00 D44).
 */

export function PassportAccount({
  identity,
  api,
  onIdentity,
  onState,
}: {
  identity: PassportIdentity
  api: PassportBackend
  /** A link upgraded this passport in place — merge the fresh identity. */
  onIdentity: (identity: PassportIdentity) => void
  /** The session itself changed — signed into another passport (state) or out (null). */
  onState: (state: PassportState | null) => void
}) {
  const t = useTranslations('passport')
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
        </div>
        {panel === 'link-email' && (
          <EmailOtpForm
            send={(email) => api.linkEmailStart(email)}
            verify={async (email, code) => {
              onIdentity(await api.linkEmailVerify(email, code))
            }}
          />
        )}
        {/* already have a passport? signing in folds this device's stamps and
            moments into it (docs/00 D44), so it's safe — no stay-behind warning */}
        {panel !== 'sign-in' ? (
          <button
            type="button"
            onClick={() => setPanel('sign-in')}
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
          </div>
        )}
      </section>
    )
  }

  const connectedLabel = identity.email ? t('linkedAs', { email: identity.email }) : null

  return (
    <section className="flex flex-col gap-3 border-t border-line pt-6">
      {/* account management, not the anonymous "keep this passport" pitch above */}
      <h3 className="font-display lowercase">{t('accountTitle')}</h3>
      {connectedLabel && <p className="text-sm text-orange">{connectedLabel}</p>}
      <p className="text-sm text-muted">{t('otherDeviceHint')}</p>
      {errorKey && (
        <p role="alert" className="text-sm text-red-strong">
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
          className="rounded-full border border-red/45 px-4 py-2 text-sm text-red-strong transition-colors hover:border-red hover:text-red-strong disabled:opacity-50"
        >
          {t('deleteAccount')}
        </button>
      </div>
    </section>
  )
}
