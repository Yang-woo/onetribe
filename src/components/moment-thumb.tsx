import { youtubeThumbnail, type Moment } from '@/lib/moments'

/**
 * Wall card — the photo is the hero, UI stays quiet (docs/12).
 * Plain <img>: R2 sizing variants come with the W4 CDN setup.
 */
export function MomentThumb({ moment }: { moment: Moment }) {
  const src =
    moment.thumb_url ??
    (moment.media_kind === 'clip'
      ? (youtubeThumbnail(moment.embed_url ?? '') ?? undefined)
      : (moment.media_url ?? undefined))
  if (!src) return null

  return (
    <figure className="mb-3 break-inside-avoid overflow-hidden rounded-lg bg-surface">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={moment.caption ?? 'festival moment'} loading="lazy" className="w-full" />
      {(moment.caption || moment.author_name) && (
        <figcaption className="flex flex-col gap-0.5 px-3 py-2 text-sm">
          {moment.caption && <span className="text-paper">{moment.caption}</span>}
          {moment.author_name && <span className="text-muted">@{moment.author_name}</span>}
        </figcaption>
      )}
    </figure>
  )
}
