'use client'

import { useLocale, useTranslations } from 'next-intl'
import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react'
import { countryOptions, type CountryOption, filterCountries } from '@/lib/country'

/**
 * The "where you're from" field — a searchable country combobox (docs/00 D31).
 * Shared by the upload wizard and the passport profile editor, mirroring
 * InstagramField (docs/00 D30): the value is a bare ISO 3166-1 alpha-2 code (or
 * ''), the parent owns it, and copy lives in the `upload` namespace (reused
 * verbatim, not re-keyed per surface).
 *
 * Search matches the viewer's language, the English name, the code and common
 * aliases (filterCountries) so "korea" / "holland" / "uk" / "한국" all resolve.
 * Names come from ICU — no shipped name table (17 locales for free).
 */
export function CountryField({
  value,
  onChange,
}: {
  /** ISO 3166-1 alpha-2 code, or '' for none. */
  value: string
  onChange: (code: string) => void
}) {
  const t = useTranslations('upload')
  const locale = useLocale()
  const options = useMemo(() => countryOptions(locale), [locale])
  const selected = useMemo(() => options.find((o) => o.code === value) ?? null, [options, value])
  const displayLabel = selected ? `${selected.flag}  ${selected.name}` : ''

  const [focused, setFocused] = useState(false)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const baseId = useId()
  const inputId = `${baseId}-input`
  const listId = `${baseId}-list`
  const optionId = (code: string) => `${baseId}-opt-${code}`

  // On focus the query starts equal to the current label; treat "unchanged" as
  // no filter, so the full list shows and select-all lets a keystroke replace it.
  const searchText = query === displayLabel ? '' : query
  const results = useMemo(() => filterCountries(searchText, options), [searchText, options])

  useEffect(
    () => () => {
      if (blurTimer.current) clearTimeout(blurTimer.current)
    },
    [],
  )

  // Keep the active option scrolled into view during keyboard navigation.
  // (scrollIntoView is absent in jsdom — optional-call so tests don't throw.)
  useEffect(() => {
    if (!open || active < 0 || !results[active]) return
    document.getElementById(`${baseId}-opt-${results[active].code}`)?.scrollIntoView?.({
      block: 'nearest',
    })
  }, [open, active, results, baseId])

  const commit = (o: CountryOption) => {
    onChange(o.code)
    setOpen(false)
    setFocused(false)
    setActive(-1)
    inputRef.current?.blur()
  }

  const move = (delta: number) => {
    if (!results.length) return
    setActive((cur) => {
      const next = cur + delta
      if (next < 0) return results.length - 1
      if (next >= results.length) return 0
      return next
    })
  }

  const inputValue = focused ? query : displayLabel

  return (
    <div className="flex flex-col gap-1 text-sm text-muted">
      <label htmlFor={inputId}>{t('countryLabel')}</label>
      <div className="relative">
        <input
          id={inputId}
          ref={inputRef}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            open && active >= 0 ? optionId(results[active]?.code ?? '') : undefined
          }
          autoComplete="off"
          spellCheck={false}
          value={inputValue}
          placeholder={t('countryPlaceholder')}
          onFocus={() => {
            if (blurTimer.current) clearTimeout(blurTimer.current)
            setFocused(true)
            setQuery(displayLabel)
            setOpen(true)
            setActive(-1)
            // select-all so the first keystroke replaces the pre-filled label.
            // Sync (the DOM value is already displayLabel and stays it) — no
            // async caret race (docs/00 D29).
            inputRef.current?.select()
          }}
          onChange={(e) => {
            setFocused(true)
            setQuery(e.target.value)
            setOpen(true)
            setActive(-1)
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setOpen(true)
              move(1)
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setOpen(true)
              move(-1)
            } else if (e.key === 'Enter') {
              if (open && active >= 0 && results[active]) {
                e.preventDefault()
                commit(results[active])
              }
            } else if (e.key === 'Escape') {
              if (open) {
                e.preventDefault()
                setOpen(false)
                setActive(-1)
                inputRef.current?.blur()
              }
            }
          }}
          onBlur={() => {
            // A short delay lets an option click (which preventDefaults its
            // mousedown to keep focus) commit before the list closes.
            blurTimer.current = setTimeout(() => {
              setOpen(false)
              setFocused(false)
              setActive(-1)
            }, 120)
          }}
          className="w-full rounded-lg border border-line bg-surface px-3 py-2 pr-8 text-paper placeholder:text-muted transition-colors focus:border-[rgba(255,106,0,.5)] focus:outline-none"
        />
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs transition-transform ${
            open ? 'rotate-180 text-orange' : 'text-muted'
          }`}
        >
          ▾
        </span>
        {open && (
          <ul
            id={listId}
            role="listbox"
            className="absolute left-0 right-0 z-20 mt-1.5 max-h-64 overflow-y-auto rounded-lg border border-line bg-surface-raised p-1 shadow-[0_18px_40px_rgba(0,0,0,.5)]"
          >
            {results.length === 0 ? (
              <li className="px-3 py-2.5 text-xs text-muted">{t('countryNoMatch')}</li>
            ) : (
              results.map((o, i) => (
                <li
                  key={o.code}
                  id={optionId(o.code)}
                  role="option"
                  aria-selected={o.code === value}
                  // mousedown, not click: fire before the input's blur so the
                  // list is still open; preventDefault keeps input focus.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => commit(o)}
                  className={`flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 ${
                    i === active ? 'bg-[rgba(255,106,0,.14)]' : ''
                  }`}
                >
                  <span aria-hidden="true" className="w-5 text-center text-base leading-none">
                    {o.flag}
                  </span>
                  <span className="text-paper">{highlight(o.name, searchText)}</span>
                  {o.en !== o.name && (
                    <span className="ml-auto truncate pl-3 text-xs text-muted">
                      {highlight(o.en, searchText)}
                    </span>
                  )}
                </li>
              ))
            )}
          </ul>
        )}
      </div>
    </div>
  )
}

/** Bold the matched slice of a name — cosmetic (raw substring, case-insensitive). */
function highlight(text: string, query: string): ReactNode {
  const q = query.trim()
  if (!q) return text
  const i = text.toLowerCase().indexOf(q.toLowerCase())
  if (i < 0) return text
  return (
    <>
      {text.slice(0, i)}
      <mark className="bg-transparent font-semibold text-orange">
        {text.slice(i, i + q.length)}
      </mark>
      {text.slice(i + q.length)}
    </>
  )
}
