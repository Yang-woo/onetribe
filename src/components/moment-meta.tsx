'use client'

import { useLocale } from 'next-intl'
import { countryFlag, countryName } from '@/lib/country'
import { relativeTime } from '@/lib/format'
import type { Moment } from '@/lib/moments'
import { AuthorTag } from './author-tag'

/** Decorative dot between meta fields. */
export function MetaSep() {
  return (
    <span aria-hidden="true" className="text-[#6e655c]">
      ·
    </span>
  )
}

/**
 * A moment's origin country as a flag (docs/00 D31). `withName` adds the
 * localized name after the flag (the detail page, which has room); otherwise
 * just the flag with the name on hover (the compact card/modal). Falls back to
 * the raw code when a flag can't be derived. Pure — usable server- or
 * client-side.
 */
export function CountryLabel({
  code,
  locale,
  withName = false,
}: {
  code: string
  locale: string
  withName?: boolean
}) {
  const flag = countryFlag(code)
  const name = countryName(code, locale)
  return <span title={name}>{withName ? `${flag ? `${flag} ` : ''}${name}` : flag || code}</span>
}

/**
 * The wall identity line shared by the card and the moment modal: author
 * (AuthorTag) · origin country · relative time. One source so the card and the
 * modal can't drift. `center` matches the modal's centered panel.
 */
export function MomentMeta({ moment, center = false }: { moment: Moment; center?: boolean }) {
  const locale = useLocale()
  return (
    <span
      className={`flex flex-wrap items-center gap-1.5 text-xs text-muted${
        center ? ' justify-center' : ''
      }`}
    >
      <AuthorTag moment={moment} />
      {moment.origin_country && (
        <>
          <MetaSep />
          <CountryLabel code={moment.origin_country} locale={locale} />
        </>
      )}
      <MetaSep />
      <span suppressHydrationWarning>{relativeTime(moment.created_at, locale)}</span>
    </span>
  )
}
