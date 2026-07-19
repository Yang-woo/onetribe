'use client'

import { useLocale, useTranslations } from 'next-intl'
import { useState } from 'react'
import type { PassportBackend, PassportIdentity } from '@/lib/passport/backend'
import { EmailOtpForm } from './email-otp-form'

/**
 * Passport account section (docs/15 §4, D16). Anonymous passports get the
 * "keep this passport" upgrade (email OTP / Google link — same user id, so
 * stamps and moments carry over); upgraded ones show what's connected plus
 * sign-out and GDPR self-serve deletion.
 */

export function passportReturnUrl(locale: string): string {
  return `${window.location.origin}/${locale}/passport`
}

export function PassportAccount({
  identity,
  api,
  onRefresh,
  googleEnabled = process.env.NEXT_PUBLIC_AUTH_GOOGLE === '1',
}: {
  identity: PassportIdentity
  api: PassportBackend
  onRefresh: () => void
  googleEnabled?: boolean
}) {
  const t = useTranslations('passport')
  const locale = useLocale()
  const [panel, setPanel] = useState<'none' | 'link-email' | 'sign-in'>('none')
  const [busy, setBusy] = useState(false)

  const secondaryButton =
    'rounded-full border border-line px-4 py-2 text-sm text-paper transition-colors hover:border-orange hover:text-orange disabled:opacity-50'

  if (identity.isAnonymous) {
    return (
      <section className="flex flex-col gap-3 border-t border-line pt-6">
        <h3 className="font-display lowercase">{t('keepTitle')}</h3>
        <p className="text-sm text-muted">{t('keepHint')}</p>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => setPanel(panel === 'link-email' ? 'none' : 'link-email')}
            className={secondaryButton}
          >
            {t('connectEmail')}
          </button>
          {googleEnabled && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setBusy(true)
                void api.linkGoogle(passportReturnUrl(locale)).catch(() => setBusy(false))
              }}
              className={secondaryButton}
            >
              {t('connectGoogle')}
            </button>
          )}
        </div>
        {panel === 'link-email' && (
          <EmailOtpForm
            send={(email) => api.linkEmailStart(email)}
            verify={async (email, code) => {
              await api.linkEmailVerify(email, code)
              onRefresh()
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
                await api.signInEmailVerify(email, code)
                onRefresh()
              }}
            />
            {googleEnabled && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setBusy(true)
                  void api.signInGoogle(passportReturnUrl(locale)).catch(() => setBusy(false))
                }}
                className={`self-start ${secondaryButton}`}
              >
                {t('connectGoogle')}
              </button>
            )}
          </div>
        )}
      </section>
    )
  }

  return (
    <section className="flex flex-col gap-3 border-t border-line pt-6">
      <h3 className="font-display lowercase">{t('keepTitle')}</h3>
      <p className="text-sm text-orange">
        {identity.email
          ? t('linkedAs', { email: identity.email })
          : identity.providers.includes('google')
            ? t('linkedGoogle')
            : null}
      </p>
      <p className="text-sm text-muted">{t('otherDeviceHint')}</p>
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            void api
              .signOut()
              .then(onRefresh)
              .finally(() => setBusy(false))
          }}
          className={secondaryButton}
        >
          {t('signOut')}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (!window.confirm(t('deleteConfirm'))) return
            setBusy(true)
            void api
              .deleteAccount()
              .then(onRefresh)
              .finally(() => setBusy(false))
          }}
          className="rounded-full border border-red/45 px-4 py-2 text-sm text-red/80 transition-colors hover:border-red hover:text-red disabled:opacity-50"
        >
          {t('deleteAccount')}
        </button>
      </div>
    </section>
  )
}
