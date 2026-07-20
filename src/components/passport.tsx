'use client'

import { useLocale, useTranslations } from 'next-intl'
import { useEffect, useMemo, useState } from 'react'
import type { EditionChip } from '@/lib/moments'
import {
  GOOGLE_AUTH_ENABLED,
  consumeOauthReturnError,
  createSupabasePassportBackend,
  passportReturnUrl,
  type PassportAuthErrorCode,
  type PassportBackend,
  type PassportState,
} from '@/lib/passport/backend'
import { Link } from '@/i18n/navigation'
import { EmailOtpForm } from './email-otp-form'
import { MomentThumb } from './moment-thumb'
import { PassportAccount } from './passport-account'
import { inputClass, secondaryButtonClass } from './ui'

// Deterministic "hand-stamped" tilt per edition id (§4-1) — stable across
// renders, never random and never per-render. Only attended/canceled stamps
// tilt; unvisited years stay flat.
const ROTS = [-3, -2, -1, 1, 2, 3]
const rot = (id: string) => ROTS[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % ROTS.length]

/**
 * Festival Passport — docs/15 §4, the retention seed (D3). Anonymous
 * start, edition checklist, the "my Nth defqon" badge, own uploads.
 */
export function Passport({
  editions,
  backend,
}: {
  editions: EditionChip[]
  backend?: PassportBackend
}) {
  const t = useTranslations('passport')
  const locale = useLocale()
  const api = useMemo(() => backend ?? createSupabasePassportBackend(), [backend])
  // undefined = loading, null = no passport yet, object = active session
  const [state, setState] = useState<PassportState | null | undefined>(undefined)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [signIn, setSignIn] = useState(false)
  const [oauthErrorKey, setOauthErrorKey] = useState<PassportAuthErrorCode | null>(null)

  useEffect(() => {
    // OAuth return errors arrive as URL params — the backend reads and strips
    // them through the same GoTrue error map as the promise-based flows (D16).
    const returnedError = consumeOauthReturnError()
    void api.load().then((loaded) => {
      setState(loaded)
      if (returnedError) setOauthErrorKey(returnedError)
    })
  }, [api])

  if (state === undefined) return null

  if (!state) {
    return (
      <section className="flex flex-col gap-6">
        <div className="flex flex-col gap-4">
          <h2 className="font-display text-xl lowercase">{t('startTitle')}</h2>
          <input
            value={name}
            aria-label={t('namePlaceholder')}
            placeholder={t('namePlaceholder')}
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
          />
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                setState(await api.start(name))
              } finally {
                setBusy(false)
              }
            }}
            className="self-start rounded-full bg-orange px-6 py-3 font-medium text-black disabled:opacity-50"
          >
            {t('start')}
          </button>
        </div>

        {/* returning warrior — no session on this screen, so signing in can't orphan stamps */}
        <div className="flex flex-col gap-3 border-t border-line pt-5">
          {oauthErrorKey && (
            <p role="alert" className="text-sm text-red">
              {t(oauthErrorKey)}
            </p>
          )}
          {!signIn ? (
            <button
              type="button"
              onClick={() => setSignIn(true)}
              className="self-start text-sm text-muted underline-offset-2 hover:text-paper hover:underline"
            >
              {t('signInTitle')}
            </button>
          ) : (
            <>
              <h3 className="font-display lowercase">{t('signInTitle')}</h3>
              <p className="text-sm text-muted">{t('signInHint')}</p>
              <EmailOtpForm
                send={(email) => api.signInEmailStart(email)}
                verify={async (email, code) => {
                  setState(await api.signInEmailVerify(email, code))
                }}
              />
              {GOOGLE_AUTH_ENABLED && (
                <button
                  type="button"
                  onClick={() => void api.signInGoogle(passportReturnUrl(locale))}
                  className={`self-start ${secondaryButtonClass}`}
                >
                  {t('connectGoogle')}
                </button>
              )}
            </>
          )}
        </div>
      </section>
    )
  }

  const n = state.attendedEventIds.length
  const attended = new Set(state.attendedEventIds)
  const attendedYears = editions.filter((e) => attended.has(e.id)).map((e) => e.year)
  const firstYear = attendedYears.length ? Math.min(...attendedYears) : null
  // 1-based ordinal of each attended edition among the user's attended years,
  // sorted ascending — the stamp sublabel ("1st", "2nd", …) (§4-1).
  const ordinalById = new Map(
    editions
      .filter((e) => attended.has(e.id))
      .sort((a, b) => a.year - b.year)
      .map((e, i) => [e.id, i + 1] as const),
  )
  // a quiet story line, not a rank badge: "since 2019 · 3 editions", or the
  // emotionally bigger "my first defqon" for a first-timer. year is a string
  // so ICU doesn't number-format it into "2,024".
  const identity =
    n === 1
      ? t('firstDefqon')
      : firstYear
        ? t('since', { year: String(firstYear), count: n })
        : null

  async function toggle(eventId: string) {
    if (!state) return
    const on = !attended.has(eventId)
    // optimistic — RLS guarantees only own rows change (tests/db/rls ⑥)
    setState({
      ...state,
      attendedEventIds: on
        ? [...state.attendedEventIds, eventId]
        : state.attendedEventIds.filter((id) => id !== eventId),
    })
    await api.setAttendance(eventId, on)
  }

  return (
    <section className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h2 className="font-display text-xl lowercase">{t('journey')}</h2>
        {state.displayName && <p className="text-sm text-muted">@{state.displayName}</p>}
        {identity && <p className="text-sm text-muted">{identity}</p>}
      </header>

      {/* the moments are the hero — this is what the passport is for */}
      <section className="flex flex-col gap-3">
        <h3 className="font-display lowercase">
          {t('myMoments', { count: state.moments.length })}
        </h3>
        {state.moments.length === 0 ? (
          <div className="flex flex-col items-start gap-3 rounded-lg border border-line p-6">
            <p className="text-sm text-muted">{t('noMoments')}</p>
            <Link
              href="/upload"
              className="rounded-full bg-orange px-5 py-2 text-sm font-medium text-black"
            >
              {t('addFirstMoment')}
            </Link>
          </div>
        ) : (
          <div className="columns-2 gap-3 sm:columns-3">
            {state.moments.map((moment) => (
              <MomentThumb key={moment.id} moment={moment} />
            ))}
            {/* one more moment — a quiet dashed tile at the end of the wall */}
            <Link
              href="/upload"
              className="mb-3 flex aspect-square break-inside-avoid flex-col items-center justify-center gap-0.5 rounded-lg border border-dashed border-[rgba(163,154,144,.3)] hover:border-orange"
            >
              <span aria-hidden="true" className="text-[18px] text-orange">
                +
              </span>
              <span className="text-[11px] text-muted">{t('addMoment')}</span>
            </Link>
          </div>
        )}
      </section>

      {/* editions attended — secondary; a tappable history map */}
      <section className="flex flex-col gap-3">
        <h3 className="font-display lowercase">{t('editionsHeading')}</h3>
        {n === 0 && <p className="text-sm text-muted">{t('noneChecked')}</p>}
        <div
          className="grid grid-cols-4 gap-3 sm:grid-cols-5"
          role="group"
          aria-label={t('editionsHeading')}
        >
          {editions.map((edition) => {
            const on = attended.has(edition.id)
            const canceled = edition.canceled
            return (
              <button
                key={edition.id}
                type="button"
                aria-pressed={on}
                onClick={() => void toggle(edition.id)}
                // stable per-id tilt; only stamped (attended/canceled) years lean
                style={{ transform: on || canceled ? `rotate(${rot(edition.id)}deg)` : undefined }}
                className={`flex aspect-square flex-col items-center justify-center gap-px rounded-full transition-colors ${
                  on
                    ? 'border-2 border-orange bg-[rgba(255,106,0,.07)] text-orange'
                    : canceled
                      ? 'border-2 border-dashed border-red/45 text-red/70'
                      : 'border border-line text-muted hover:text-paper'
                }`}
              >
                <span className="font-display text-[15px] font-semibold">{edition.year}</span>
                {(on || canceled) && (
                  // decorative sublabel — the year stays the button's a11y name
                  <span aria-hidden="true" className="text-[9px] tracking-[.04em] opacity-75">
                    {on
                      ? t('stampOrdinal', { n: ordinalById.get(edition.id) ?? 0 })
                      : t('stampCanceled')}
                  </span>
                )}
              </button>
            )
          })}
        </div>
        <p className="text-xs text-[#6e655c]">{t('stampHint')}</p>
      </section>

      {/* keep / manage the passport — upgrade while anonymous, account controls after */}
      <PassportAccount
        identity={state.identity}
        api={api}
        // a link only changes who the passport belongs to — merge, don't refetch
        onIdentity={(identity) => setState((s) => (s ? { ...s, identity } : s))}
        onState={setState}
      />
    </section>
  )
}
