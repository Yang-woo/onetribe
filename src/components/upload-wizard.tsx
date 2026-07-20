'use client'

import { useLocale, useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { useEffect, useRef, useState } from 'react'
import type { EditionChip } from '@/lib/moments'
import { supabaseBrowser } from '@/lib/supabase/browser'
import { prepareForUpload, validateFiles } from '@/lib/upload/client-image'
import {
  ALLOWED_MIME,
  MAX_AUTHOR_NAME_LENGTH,
  MAX_CAPTION_LENGTH,
  MAX_FILES_PER_MOMENT,
} from '@/lib/upload/constants'
import { isTurnstileEnabled, Turnstile } from './turnstile'
import { inputClass } from './ui'

/**
 * 2-step upload, no login — docs/15 §2 (redesign 2026-07-16 §3). Step 1 is
 * media + edition + caption; step 2 is the signature, the rights gate and the
 * bot check. Instant publish (D7): submit ends with the moment already on the
 * wall plus a private delete link. The rights checkbox is the legal gate
 * (docs/05): submit stays disabled without it, and the server enforces it again.
 * The submit pipeline (presign → R2 PUT → /api/memories) is unchanged — fields
 * only moved between steps.
 */

type Step = 1 | 2
type Mode = 'files' | 'embed'

/** A selected photo with its preview URL and in-flight compression promise. */
interface Picked {
  file: File
  /** object URL for the thumbnail — revoked on remove and on unmount */
  url: string
  /** compression starts at selection so it overlaps step 2 (form filling) */
  prepare: Promise<File>
}

interface DoneMoment {
  id: string
  takedownToken: string
}

const EDITION_PREVIEW_COUNT = 6

/** Same label grammar the old <select> used, so stored values are unchanged. */
function editionLabel(edition: EditionChip): string {
  return `${edition.year}${edition.edition ? ` — ${edition.edition}` : ''}${
    edition.canceled ? ' (canceled)' : ''
  }`
}

export function UploadWizard({
  editions,
  prepareImpl = prepareForUpload,
}: {
  editions: EditionChip[]
  /** test seam — canvas compression can't run in jsdom */
  prepareImpl?: (file: File) => Promise<File>
}) {
  const t = useTranslations('upload')
  const [step, setStep] = useState<Step>(1)
  const [mode, setMode] = useState<Mode>('files')
  const [picked, setPicked] = useState<Picked[]>([])
  const [dragging, setDragging] = useState(false)
  const [embedUrl, setEmbedUrl] = useState('')
  const [eventId, setEventId] = useState('')
  const [olderOpen, setOlderOpen] = useState(false)
  const [caption, setCaption] = useState('')
  const [authorName, setAuthorName] = useState('')
  const [authorLink, setAuthorLink] = useState('')
  const [rights, setRights] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState<DoneMoment[] | null>(null)
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Revoke leftover preview URLs only when the wizard unmounts — a ref keeps
  // the latest list without re-running cleanup on every selection change.
  const pickedRef = useRef(picked)
  useEffect(() => {
    pickedRef.current = picked
  })
  useEffect(
    () => () => {
      for (const p of pickedRef.current) URL.revokeObjectURL(p.url)
    },
    [],
  )

  const files = picked.map((p) => p.file)
  const invalidFiles = validateFiles(files)
  const fileError = !invalidFiles
    ? null
    : invalidFiles.kind === 'too-many'
      ? t('errors.tooMany')
      : invalidFiles.kind === 'unsupported-type'
        ? t('errors.unsupported')
        : t('errors.tooLarge')

  const mediaReady = mode === 'files' ? files.length > 0 && !fileError : embedUrl.trim().length > 0

  const selectedEdition = editions.find((e) => e.id === eventId) ?? null
  const visibleEditions = olderOpen ? editions : editions.slice(0, EDITION_PREVIEW_COUNT)
  const hasOlderEditions = editions.length > EDITION_PREVIEW_COUNT

  /** Append newly picked files (selection or drop). Old code replaced. */
  function appendFiles(incoming: File[]) {
    if (incoming.length === 0) return
    setError(null)
    const entries: Picked[] = incoming.map((file) => {
      const prepare = prepareImpl(file)
      // mark handled so a decode failure never unhandled-rejects before submit
      // attaches its own handler
      prepare.catch(() => {})
      return { file, url: URL.createObjectURL(file), prepare }
    })
    setPicked((prev) => [...prev, ...entries])
  }

  function removeFile(index: number) {
    setError(null)
    setPicked((prev) => {
      const next = [...prev]
      const [gone] = next.splice(index, 1)
      if (gone) URL.revokeObjectURL(gone.url)
      return next
    })
  }

  function next() {
    setError(null)
    if (!mediaReady) {
      // a file-level error (too many / wrong type / too large) already renders
      // its own alert; only nudge when there's nothing usable yet
      if (mode === 'files' && files.length > 0) return
      setError(mode === 'files' ? t('errors.needFiles') : t('errors.badEmbed'))
      return
    }
    if (!eventId) {
      setError(t('errors.needEvent'))
      return
    }
    setStep(2)
  }

  async function submit() {
    if (!rights || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      // Passport attribution is best-effort: no session (or no Supabase env
      // in tests) simply means an unattributed upload.
      let authToken: string | undefined
      try {
        const { data: sessionData } = await supabaseBrowser().auth.getSession()
        authToken = sessionData.session?.access_token
      } catch {
        authToken = undefined
      }
      const shared = {
        authToken,
        eventId,
        caption: caption.trim() || undefined,
        authorName: authorName.trim() || undefined,
        authorLink: authorLink.trim() || undefined,
        rightsConfirmed: true as const,
      }

      let payload: Record<string, unknown>
      if (mode === 'files') {
        // Retry recompresses from scratch: a cached rejected prepare promise
        // would otherwise re-await the same failure forever.
        let prepared: File[]
        try {
          prepared = await Promise.all(picked.map((p) => p.prepare))
        } catch {
          prepared = await Promise.all(picked.map((p) => prepareImpl(p.file)))
        }
        const presignRes = await fetch('/api/upload/presign', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            turnstileToken: turnstileToken ?? undefined,
            files: prepared.map((file) => ({ contentType: file.type, size: file.size })),
          }),
        })
        if (!presignRes.ok) throw new Error('presign failed')
        const { uploads, session } = (await presignRes.json()) as {
          uploads: Array<{ key: string; uploadUrl: string; headers: Record<string, string> }>
          session: string
        }
        await Promise.all(
          uploads.map(async (upload, i) => {
            const put = await fetch(upload.uploadUrl, {
              method: 'PUT',
              headers: upload.headers,
              body: prepared[i],
            })
            if (!put.ok) throw new Error('upload failed')
          }),
        )
        payload = {
          ...shared,
          session,
          media: uploads.map((upload, i) => ({
            key: upload.key,
            contentType: prepared[i].type,
          })),
        }
      } else {
        payload = {
          ...shared,
          turnstileToken: turnstileToken ?? undefined,
          embed: { url: embedUrl.trim() },
        }
      }

      const res = await fetch('/api/memories', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error('memories failed')
      const { moments } = (await res.json()) as { moments: DoneMoment[] }
      setDone(moments)
    } catch {
      setError(t('errors.failed'))
    } finally {
      setSubmitting(false)
    }
  }

  if (done) return <DoneScreen moments={done} />

  const segBase = 'flex-1 rounded-full py-1.5 text-center transition-colors'
  const segActive = 'bg-orange font-medium text-black'
  const segIdle = 'text-muted hover:text-paper'

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-4">
          <h1 className="font-display text-3xl font-medium lowercase tracking-tight">
            {step === 1 ? t('title') : t('signTitle')}
          </h1>
          <span className="font-display text-sm text-orange">{t('step', { n: step })}</span>
        </div>
        <div aria-label="progress" className="h-[3px] rounded-full bg-surface">
          <div
            className="h-[3px] rounded-full bg-orange transition-[width] duration-250"
            style={{ width: step === 1 ? '50%' : '100%' }}
          />
        </div>
      </div>

      {step === 1 && (
        <section className="flex flex-col gap-5">
          {/* mode segment — replaces the old text-link toggle */}
          <div role="tablist" className="flex rounded-full border border-line p-[3px] text-sm">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'files'}
              onClick={() => setMode('files')}
              className={`${segBase} ${mode === 'files' ? segActive : segIdle}`}
            >
              {t('modePhotos')}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'embed'}
              onClick={() => setMode('embed')}
              className={`${segBase} ${mode === 'embed' ? segActive : segIdle}`}
            >
              {t('modeEmbed')}
            </button>
          </div>

          {mode === 'files' ? (
            <div className="flex flex-col gap-2">
              {/* always mounted so getByLabel('photos') works at any file count */}
              <input
                ref={fileInputRef}
                type="file"
                accept={Object.keys(ALLOWED_MIME).join(',')}
                multiple
                aria-label="photos"
                className="sr-only"
                onChange={(e) => {
                  appendFiles(Array.from(e.target.files ?? []))
                  e.target.value = '' // let the same file re-trigger change
                }}
              />
              <div
                onDragOver={(e) => {
                  e.preventDefault()
                  setDragging(true)
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault()
                  setDragging(false)
                  appendFiles(Array.from(e.dataTransfer.files))
                }}
                className="grid grid-cols-3 gap-2 sm:grid-cols-4"
              >
                {picked.map((p, i) => (
                  <div
                    key={p.url}
                    className="relative aspect-square overflow-hidden rounded-lg bg-surface"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.url} alt="" loading="lazy" className="h-full w-full object-cover" />
                    <button
                      type="button"
                      aria-label={t('removePhoto')}
                      onClick={() => removeFile(i)}
                      className="absolute right-1 top-1 grid h-[22px] w-[22px] place-items-center rounded-full bg-[rgba(11,9,8,.85)] text-[11px] text-muted hover:text-paper"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                {picked.length < MAX_FILES_PER_MOMENT && (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className={`flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border border-dashed ${
                      dragging ? 'border-[rgba(255,106,0,.6)]' : 'border-[rgba(163,154,144,.35)]'
                    } hover:border-[rgba(255,106,0,.6)]`}
                  >
                    <span className="text-xl text-orange">+</span>
                    <span className="text-[11px] text-muted">
                      {picked.length} / {MAX_FILES_PER_MOMENT}
                    </span>
                  </button>
                )}
              </div>
              <p className="text-[13px] text-[#6e655c]">{t('dropHint')}</p>
              {fileError && (
                <p role="alert" className="text-sm text-warning">
                  {fileError}
                </p>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <input
                type="url"
                value={embedUrl}
                aria-label="youtube link"
                placeholder={t('embedPlaceholder')}
                onChange={(e) => setEmbedUrl(e.target.value)}
                className={inputClass}
              />
              <p className="text-[13px] text-[#6e655c]">{t('embedHint')}</p>
            </div>
          )}

          {/* edition chips — replace the old <select> */}
          <div className="flex flex-col gap-2">
            <span className="text-sm text-muted">{t('whichMoment')}</span>
            <div role="radiogroup" aria-label={t('whichMoment')} className="flex flex-wrap gap-1.5">
              {visibleEditions.map((edition) => {
                const selected = edition.id === eventId
                return (
                  <button
                    key={edition.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => {
                      setEventId(edition.id)
                      setError(null)
                    }}
                    className={`min-h-[32px] whitespace-nowrap rounded-full border px-3 py-1 text-sm transition-colors ${
                      selected
                        ? 'border-orange text-orange'
                        : edition.canceled
                          ? 'border-red/40 text-red'
                          : 'border-line text-muted hover:text-paper'
                    }`}
                  >
                    {edition.year}
                  </button>
                )
              })}
              {hasOlderEditions && (
                <button
                  type="button"
                  onClick={() => setOlderOpen((o) => !o)}
                  className="min-h-[32px] whitespace-nowrap rounded-full border border-line px-3 py-1 text-sm text-muted hover:text-paper"
                >
                  {olderOpen ? `${t('collapse')} ▴` : `${t('olderEditions')} ▾`}
                </button>
              )}
            </div>
            {selectedEdition && (
              <p className="text-xs text-flame">{editionLabel(selectedEdition)}</p>
            )}
          </div>

          {/* caption — unchanged copy/limits so getByLabel(/say something/) matches */}
          <label className="flex flex-col gap-1 text-sm text-muted">
            {t('captionLabel')}
            <textarea
              value={caption}
              maxLength={MAX_CAPTION_LENGTH}
              rows={3}
              onChange={(e) => setCaption(e.target.value)}
              className={inputClass}
            />
            <span className="self-end text-xs">
              {caption.length}/{MAX_CAPTION_LENGTH}
            </span>
          </label>
        </section>
      )}

      {step === 2 && (
        <section className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm text-muted">
            {t('nameLabel')}
            <input
              value={authorName}
              maxLength={MAX_AUTHOR_NAME_LENGTH}
              onChange={(e) => setAuthorName(e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-muted">
            {t('igLabel')}
            <input
              value={authorLink}
              placeholder="@yourhandle"
              onChange={(e) => setAuthorLink(e.target.value)}
              className={inputClass}
            />
          </label>
          {/* rights confirmation card — the checkbox is real (sr-only) so tests
              and form a11y keep working; the server double-checks rightsConfirmed */}
          <label
            className={`flex cursor-pointer items-start gap-2.5 rounded-lg border p-3.5 text-sm leading-[1.45] ${
              rights ? 'border-[rgba(255,106,0,.5)] bg-[rgba(255,106,0,.06)]' : 'border-line'
            }`}
          >
            <input
              type="checkbox"
              checked={rights}
              onChange={(e) => setRights(e.target.checked)}
              className="sr-only"
            />
            <span
              aria-hidden="true"
              className={`mt-px grid h-4 w-4 shrink-0 place-items-center rounded text-[11px] ${
                rights ? 'bg-orange text-black' : 'border border-[rgba(163,154,144,.4)]'
              }`}
            >
              {rights ? '✓' : ''}
            </span>
            <span>{t('rightsLabel')}</span>
          </label>
          <Turnstile onToken={setTurnstileToken} />
        </section>
      )}

      {error && (
        <p role="alert" className="text-sm text-warning">
          {error}
        </p>
      )}

      <div className="flex items-center justify-between">
        {step > 1 ? (
          <button
            type="button"
            onClick={() => setStep(1)}
            className="rounded-full border border-line px-4 py-2 text-sm text-muted hover:text-paper"
          >
            {t('back')}
          </button>
        ) : (
          <span />
        )}
        {step === 1 ? (
          <button
            type="button"
            onClick={next}
            className="rounded-full bg-orange px-7 py-2.5 font-medium text-black transition-opacity hover:opacity-90"
          >
            {t('next')}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!rights || submitting || (isTurnstileEnabled() && !turnstileToken)}
            className="rounded-full bg-orange px-7 py-2.5 font-medium text-black transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {submitting ? t('submitting') : t('submit')}
          </button>
        )}
      </div>
    </div>
  )
}

function DoneScreen({ moments }: { moments: DoneMoment[] }) {
  const t = useTranslations('upload')
  const locale = useLocale()
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)
  // Client-only screen (renders after submit) — window always exists.
  // The locale prefix keeps the stored link redirect-free.
  const links = moments.map(
    (moment) => `${window.location.origin}/${locale}/t/${moment.id}/${moment.takedownToken}`,
  )

  return (
    <section className="flex flex-col items-center gap-5 text-center">
      <h1 className="font-display text-2xl font-medium lowercase text-orange">{t('doneTitle')}</h1>
      <p className="max-w-[420px] text-sm text-muted">{t('doneBody')}</p>
      <div className="flex w-full flex-col gap-2">
        {links.map((link, i) => (
          <div
            key={link}
            className="flex items-center gap-2 rounded-lg border border-[rgba(163,154,144,.2)] bg-surface px-3 py-2.5"
          >
            <span className="flex-1 truncate text-left font-mono text-xs text-muted">{link}</span>
            <button
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(link)
                setCopiedIndex(i)
              }}
              className="rounded-md bg-orange px-3 py-1 text-[13px] font-medium text-black transition-opacity hover:opacity-90"
            >
              {copiedIndex === i ? t('copied') : t('copyLink')}
            </button>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <Link
          href="/"
          className="rounded-full bg-orange px-6 py-3 font-medium text-black transition-opacity hover:opacity-90"
        >
          {t('toWall')}
        </Link>
        <Link
          href="/passport"
          className="rounded-full border border-[rgba(163,154,144,.3)] px-5 py-3 text-sm text-paper hover:text-paper"
        >
          {t('toPassport')}
        </Link>
      </div>
    </section>
  )
}
