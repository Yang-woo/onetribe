'use client'

import { useTranslations } from 'next-intl'
import { useEffect, useMemo, useState } from 'react'
import type { EditionChip } from '@/lib/moments'
import {
  createSupabasePassportBackend,
  type PassportBackend,
  type PassportState,
} from '@/lib/passport/backend'
import { siteUrl } from '@/lib/site-url'
import { MomentThumb } from './moment-thumb'
import { inputClass } from './ui'

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
  const api = useMemo(() => backend ?? createSupabasePassportBackend(), [backend])
  // undefined = loading, null = no passport yet, object = active session
  const [state, setState] = useState<PassportState | null | undefined>(undefined)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [shared, setShared] = useState(false)

  useEffect(() => {
    void api.load().then(setState)
  }, [api])

  if (state === undefined) return null

  if (!state) {
    return (
      <section className="flex flex-col gap-4">
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
      </section>
    )
  }

  const n = state.attendedEventIds.length
  const attended = new Set(state.attendedEventIds)

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
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h2 className="font-display text-xl lowercase">{t('journey')}</h2>
        {state.displayName && <p className="text-sm text-muted">@{state.displayName}</p>}
      </header>

      {n > 0 ? (
        <div className="flex items-center gap-3">
          <p className="font-display text-2xl lowercase text-orange">{t('badge', { n })}</p>
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard.writeText(`${t('badge', { n })} — ${siteUrl()}`)
              setShared(true)
            }}
            className="rounded-full border border-line px-3 py-1 text-sm text-muted hover:text-paper"
          >
            {shared ? t('shared') : t('share')}
          </button>
        </div>
      ) : (
        <p className="text-sm text-muted">{t('noneChecked')}</p>
      )}

      <div className="grid grid-cols-4 gap-2 sm:grid-cols-6" role="group" aria-label={t('journey')}>
        {editions.map((edition) => {
          const on = attended.has(edition.id)
          return (
            <button
              key={edition.id}
              type="button"
              aria-pressed={on}
              onClick={() => void toggle(edition.id)}
              className={`rounded-lg border px-2 py-2 text-sm transition-colors ${
                on
                  ? 'border-orange bg-surface text-orange'
                  : edition.canceled
                    ? 'border-red/30 text-red/70'
                    : 'border-line text-muted hover:text-paper'
              }`}
            >
              {edition.year}
            </button>
          )
        })}
      </div>

      <section className="flex flex-col gap-3">
        <h3 className="font-display lowercase">
          {t('myMoments', { count: state.moments.length })}
        </h3>
        {state.moments.length === 0 ? (
          <p className="text-sm text-muted">{t('noMoments')}</p>
        ) : (
          <div className="columns-2 gap-3 sm:columns-3">
            {state.moments.map((moment) => (
              <MomentThumb key={moment.id} moment={moment} />
            ))}
          </div>
        )}
      </section>
    </section>
  )
}
