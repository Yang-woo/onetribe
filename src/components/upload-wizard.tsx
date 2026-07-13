'use client'

import { useLocale, useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { useState } from 'react'
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
 * 3-step upload, no login — docs/15 §2. Instant publish (D7): submit ends
 * with the moment already on the wall plus a private delete link.
 * The rights checkbox is the legal gate (docs/05): submit stays disabled
 * without it, and the server enforces it again.
 */

type Step = 1 | 2 | 3
type Mode = 'files' | 'embed'

interface DoneMoment {
  id: string
  takedownToken: string
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
  const [files, setFiles] = useState<File[]>([])
  // compression starts at selection so it overlaps steps 2-3 (form filling)
  const [preparing, setPreparing] = useState<Promise<File>[] | null>(null)
  const [embedUrl, setEmbedUrl] = useState('')
  const [eventId, setEventId] = useState('')
  const [caption, setCaption] = useState('')
  const [authorName, setAuthorName] = useState('')
  const [authorLink, setAuthorLink] = useState('')
  const [rights, setRights] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState<DoneMoment[] | null>(null)
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)

  const invalidFiles = validateFiles(files)
  const fileError = !invalidFiles
    ? null
    : invalidFiles.kind === 'too-many'
      ? t('errors.tooMany')
      : invalidFiles.kind === 'unsupported-type'
        ? t('errors.unsupported')
        : t('errors.tooLarge')

  const step1Ready = mode === 'files' ? files.length > 0 && !fileError : embedUrl.trim().length > 0

  function next() {
    setError(null)
    if (step === 1 && !step1Ready) {
      setError(mode === 'files' ? t('errors.needFiles') : t('errors.badEmbed'))
      return
    }
    if (step === 2 && !eventId) {
      setError(t('errors.needEvent'))
      return
    }
    setStep((s) => Math.min(3, s + 1) as Step)
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
          prepared = await Promise.all(preparing ?? files.map((file) => prepareImpl(file)))
        } catch {
          prepared = await Promise.all(files.map((file) => prepareImpl(file)))
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

  return (
    <div className="flex flex-col gap-6">
      <div aria-label="progress" className="flex items-center gap-2">
        <span className="text-sm text-orange">{t('step', { n: step })}</span>
        <div className="h-1 flex-1 rounded bg-surface">
          <div
            className="h-1 rounded bg-orange transition-all"
            style={{ width: `${(step / 3) * 100}%` }}
          />
        </div>
      </div>

      {step === 1 && (
        <section className="flex flex-col gap-4">
          <h2 className="font-display text-xl lowercase">{t('pickTitle')}</h2>
          <p className="text-sm text-muted">{t('pickHint')}</p>
          {mode === 'files' ? (
            <>
              <input
                type="file"
                accept={Object.keys(ALLOWED_MIME).join(',')}
                multiple
                aria-label="photos"
                onChange={(e) => {
                  const picked = Array.from(e.target.files ?? [])
                  setFiles(picked)
                  if (validateFiles(picked)) {
                    setPreparing(null)
                  } else {
                    const promises = picked.map((f) => prepareImpl(f))
                    // mark handled so a decode failure never unhandled-rejects
                    // before submit attaches its own handler
                    promises.forEach((prom) => prom.catch(() => {}))
                    setPreparing(promises)
                  }
                }}
                className="text-sm text-muted file:mr-3 file:rounded-full file:border-0 file:bg-orange file:px-4 file:py-2 file:font-medium file:text-black"
              />
              {files.length > 0 && !fileError && (
                <ul className="flex flex-col gap-1 text-sm text-muted">
                  {files.slice(0, MAX_FILES_PER_MOMENT).map((file) => (
                    <li key={file.name}>{file.name}</li>
                  ))}
                </ul>
              )}
              {fileError && (
                <p role="alert" className="text-sm text-warning">
                  {fileError}
                </p>
              )}
              <button
                type="button"
                onClick={() => setMode('embed')}
                className="self-start text-sm text-flame hover:underline"
              >
                {t('embedToggle')}
              </button>
            </>
          ) : (
            <>
              <input
                type="url"
                value={embedUrl}
                aria-label="youtube link"
                placeholder={t('embedPlaceholder')}
                onChange={(e) => setEmbedUrl(e.target.value)}
                className={inputClass}
              />
              <button
                type="button"
                onClick={() => setMode('files')}
                className="self-start text-sm text-flame hover:underline"
              >
                {t('filesToggle')}
              </button>
            </>
          )}
        </section>
      )}

      {step === 2 && (
        <section className="flex flex-col gap-4">
          <h2 className="font-display text-xl lowercase">{t('whichMoment')}</h2>
          <select
            value={eventId}
            aria-label="edition"
            onChange={(e) => setEventId(e.target.value)}
            className={inputClass}
          >
            <option value="">—</option>
            {editions.map((edition) => (
              <option key={edition.id} value={edition.id}>
                {edition.year}
                {edition.edition ? ` — ${edition.edition}` : ''}
                {edition.canceled ? ' (canceled)' : ''}
              </option>
            ))}
          </select>
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

      {step === 3 && (
        <section className="flex flex-col gap-4">
          <h2 className="font-display text-xl lowercase">{t('nameTitle')}</h2>
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
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={rights}
              onChange={(e) => setRights(e.target.checked)}
              className="mt-0.5 accent-orange"
            />
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
            onClick={() => setStep((s) => Math.max(1, s - 1) as Step)}
            className="rounded-full border border-line px-4 py-2 text-sm text-muted hover:text-paper"
          >
            {t('back')}
          </button>
        ) : (
          <span />
        )}
        {step < 3 ? (
          <button
            type="button"
            onClick={next}
            className="rounded-full bg-orange px-6 py-2 font-medium text-black disabled:opacity-40"
          >
            {t('next')}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!rights || submitting || (isTurnstileEnabled() && !turnstileToken)}
            className="rounded-full bg-orange px-6 py-2 font-medium text-black disabled:opacity-40"
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
  const [copied, setCopied] = useState(false)
  // Client-only screen (renders after submit) — window always exists.
  // The locale prefix keeps the stored link redirect-free.
  const links = moments.map(
    (moment) => `${window.location.origin}/${locale}/t/${moment.id}/${moment.takedownToken}`,
  )

  return (
    <section className="flex flex-col items-center gap-4 text-center">
      <h2 className="font-display text-2xl lowercase text-orange">{t('doneTitle')}</h2>
      <p className="max-w-md text-sm text-muted">{t('doneBody')}</p>
      <button
        type="button"
        onClick={async () => {
          await navigator.clipboard.writeText(links.join('\n'))
          setCopied(true)
        }}
        className="rounded-full border border-line px-4 py-2 text-sm text-muted hover:text-paper"
      >
        {copied ? t('copied') : t('copyLink')}
      </button>
      <div className="flex items-center gap-3">
        <Link
          href="/"
          className="rounded-full bg-orange px-6 py-3 font-medium text-black transition-opacity hover:opacity-90"
        >
          {t('toWall')}
        </Link>
        <Link href="/passport" className="text-sm text-flame hover:underline">
          {t('toPassport')}
        </Link>
      </div>
    </section>
  )
}
