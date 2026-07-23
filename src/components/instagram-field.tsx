'use client'

import { useTranslations } from 'next-intl'
import { useId } from 'react'
import { isIgHandleInvalid, isIgUrl, normalizeIgInput } from '@/lib/upload/instagram-input'

/**
 * The instagram handle field — a segmented "@" prefix over a field that holds a
 * BARE handle (docs/00 D29). Shared by the upload wizard and the passport
 * profile editor (docs/00 D30) so the caret restore, live normalization, a11y
 * wiring, and copy stay identical in both. Copy lives in the `upload`
 * namespace (reused verbatim, not re-keyed per surface).
 *
 * The field reports only the handle; the parent computes invalidity with the
 * same isIgHandleInvalid() to gate its own submit (button disabled + a server
 * re-check — a valid-looking handle here is still re-normalized server-side).
 */
export function InstagramField({
  value,
  onChange,
}: {
  /** The bare handle (no leading "@"). */
  value: string
  onChange: (handle: string) => void
}) {
  const t = useTranslations('upload')
  const fieldId = useId()
  const hintId = `${fieldId}-hint`
  const handle = value.trim()
  const invalid = isIgHandleInvalid(value)

  return (
    <div className="flex flex-col gap-1 text-sm text-muted">
      {/* Explicit htmlFor: the visual "@" prefix must not leak into the
          accessible name, so no wrapping label here. */}
      <label htmlFor={fieldId}>{t('igLabel')}</label>
      {/* Segmented "@" prefix: the field holds a bare handle — a typed @ or a
          pasted profile URL collapses live (normalizeIgInput). */}
      <span className="group flex items-stretch overflow-hidden rounded-lg border border-line bg-surface transition-colors focus-within:border-[rgba(255,106,0,.5)]">
        <span
          aria-hidden="true"
          className={`grid place-items-center border-r border-line bg-surface-raised px-3 transition-colors group-focus-within:text-orange ${
            value ? 'text-orange' : 'text-muted'
          }`}
        >
          @
        </span>
        <input
          id={fieldId}
          value={value}
          // Deliberately not localized (D25 English-common precedent): handles
          // are ASCII-only, so a translated placeholder would demo an invalid
          // input. No maxLength — it would truncate a pasted profile URL before
          // normalizeIgInput sees it; overlong input is caught by the hint.
          placeholder="yourhandle"
          aria-invalid={invalid || undefined}
          aria-describedby={hintId}
          onChange={(e) => {
            const el = e.target
            const raw = el.value
            const normalized = normalizeIgInput(raw)
            // When the collapse shortens the value, React's rewrite snaps the
            // caret to the end — restore it synchronously, shifted by what was
            // removed (a leading "@" typed at position 0 must leave the caret
            // at 0). Sync only: writing el.value now means the later render
            // sees a matching DOM value and leaves the caret alone. (An async
            // restore — rAF/setTimeout — races fast typing and scrambles
            // input; caught by CI, docs/00 D29.)
            if (normalized !== raw) {
              const caret = el.selectionStart ?? raw.length
              const pos = Math.max(0, caret - (raw.length - normalized.length))
              el.value = normalized
              el.setSelectionRange(pos, pos)
            }
            onChange(normalized)
          }}
          className="min-w-0 flex-1 bg-transparent px-3 py-2 text-paper placeholder:text-muted focus:outline-none"
        />
      </span>
      {/* Derived-link hint: instant "yes, that's my profile" feedback. Height
          reserved so the element below never jumps. Mono is for the URL only —
          the error is prose (Space Mono is latin-only, 12-brand C). A
          non-profile instagram URL (post/reel) gets its own message —
          "invalid characters" would describe the wrong problem. */}
      <span id={hintId} className="min-h-[1.125rem] text-xs" aria-live="polite">
        {handle !== '' &&
          (invalid ? (
            <span className="text-red">{isIgUrl(handle) ? t('igNotProfile') : t('igInvalid')}</span>
          ) : (
            <span className="font-mono">
              <span className="text-orange">→ </span>
              instagram.com/{handle}
            </span>
          ))}
      </span>
    </div>
  )
}
