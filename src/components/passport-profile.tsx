'use client'

import { useLocale, useTranslations } from 'next-intl'
import { useState } from 'react'
import { countryFlag, countryName } from '@/lib/country'
import type { PassportBackend } from '@/lib/passport/backend'
import { MAX_AUTHOR_NAME_LENGTH } from '@/lib/upload/constants'
import { isIgHandleInvalid } from '@/lib/upload/instagram-input'
import { CountryField } from './country-field'
import { InstagramField } from './instagram-field'
import { inputClass, secondaryButtonClass } from './ui'

/**
 * The passport's editable identity (docs/00 D30, D31): the display name,
 * Instagram handle and home country that uploads pre-fill. Collapsed to a quiet
 * "@name · edit" line; expands to a form. Saving persists to the profile (RLS
 * owner-write) and hands the new values back so the upload form pre-fills them.
 */
export function PassportProfile({
  displayName,
  instagram,
  homeCountry,
  api,
  onSaved,
}: {
  displayName: string | null
  instagram: string | null
  homeCountry: string | null
  api: PassportBackend
  onSaved: (next: {
    displayName: string | null
    instagram: string | null
    homeCountry: string | null
  }) => void
}) {
  const t = useTranslations('passport')
  const locale = useLocale()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(displayName ?? '')
  const [ig, setIg] = useState(instagram ?? '')
  const [country, setCountry] = useState(homeCountry ?? '')
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const invalid = isIgHandleInvalid(ig)

  if (!editing) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        {displayName && <span className="text-muted">@{displayName}</span>}
        {instagram && (
          <span className="font-mono text-xs text-muted">instagram.com/{instagram}</span>
        )}
        {homeCountry && (
          <span className="text-muted">
            {countryFlag(homeCountry)} {countryName(homeCountry, locale)}
          </span>
        )}
        <button
          type="button"
          onClick={() => {
            // reset from the source of truth each open — a canceled edit leaves
            // no stale draft behind
            setName(displayName ?? '')
            setIg(instagram ?? '')
            setCountry(homeCountry ?? '')
            setFailed(false)
            setEditing(true)
          }}
          className="text-muted underline-offset-2 hover:text-paper hover:underline"
        >
          {t('editProfile')}
        </button>
      </div>
    )
  }

  const save = () => {
    if (invalid || busy) return
    setBusy(true)
    setFailed(false)
    api
      .updateProfile({ displayName: name, instagram: ig, country })
      .then((saved) => {
        onSaved(saved)
        setEditing(false)
      })
      .catch(() => setFailed(true))
      .finally(() => setBusy(false))
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line p-4">
      <label className="flex flex-col gap-1 text-sm text-muted">
        {t('namePlaceholder')}
        {/* wrapping <label> already names the field — no aria-label (it would
            override the visible label and duplicate the string) */}
        <input
          value={name}
          placeholder={t('namePlaceholder')}
          // bound the direct-to-DB write to match the upload wizard's name
          // field (rls-security review 2026-07-24, informational hardening)
          maxLength={MAX_AUTHOR_NAME_LENGTH}
          onChange={(e) => setName(e.target.value)}
          className={inputClass}
        />
      </label>
      <InstagramField value={ig} onChange={setIg} />
      <CountryField value={country} onChange={setCountry} />
      {failed && (
        <p role="alert" className="text-sm text-red">
          {t('genericError')}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={busy || invalid}
          onClick={save}
          className="self-start rounded-full bg-orange px-5 py-2 text-sm font-medium text-black disabled:opacity-50"
        >
          {t('save')}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setEditing(false)}
          className={secondaryButtonClass}
        >
          {t('cancel')}
        </button>
      </div>
    </div>
  )
}
