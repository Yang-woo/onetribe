'use client'

import { useTranslations } from 'next-intl'
import { instagramHandle } from '@/lib/format'
import type { Moment } from '@/lib/moments'

/**
 * Compact author token for the wall card and the moment modal — one identity
 * token (the /m/[id] page shows name + @handle in full). The display name and
 * the Instagram handle are DISTINCT fields (docs/00 D30), so the `@` only ever
 * prefixes the real handle (derived from author_link), never the display name:
 *  - name present → the name, linked to Instagram when there's a handle
 *  - no name, handle present → `@handle`, linked
 *  - neither → anonymous
 */
export function AuthorTag({ moment }: { moment: Pick<Moment, 'author_name' | 'author_link'> }) {
  const t = useTranslations('wall')
  const handle = instagramHandle(moment.author_link)
  const name = moment.author_name

  if (handle) {
    return (
      <a
        href={moment.author_link!}
        target="_blank"
        rel="noopener noreferrer nofollow"
        aria-label={`Instagram @${handle}`}
        className="text-flame hover:underline"
      >
        {name ?? `@${handle}`}
      </a>
    )
  }
  return <span>{name ?? t('anonymous')}</span>
}
