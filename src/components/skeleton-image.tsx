'use client'

import { useState } from 'react'

/**
 * An <img> that shows a shimmering placeholder until it decodes, then fades in
 * (docs/15 — skeletons, never spinners). The wall grid and the moment view load
 * media straight from R2, so without this a card is a blank gap until the byte
 * stream arrives — which reads as "slow". Best-effort space reservation: while
 * loading, `defaultAspectRatio` gives the box a height so the shimmer is
 * visible (we don't store real dimensions); the natural size takes over on load.
 *
 * The image keeps its own className, so a parent `group` can drive
 * `group-hover:` transforms on it (the wall's hover zoom).
 */
export function SkeletonImage({
  src,
  alt,
  className = '',
  wrapperClassName = '',
  loading,
  draggable,
  onClick,
  aspectRatio,
  defaultAspectRatio = '4 / 5',
}: {
  src: string
  alt: string
  /** classes for the <img> itself (width, object-fit, hover transforms) */
  className?: string
  /** classes for the wrapper (rounding to clip; the shimmer inherits it) */
  wrapperClassName?: string
  loading?: 'lazy' | 'eager'
  draggable?: boolean
  onClick?: (e: React.MouseEvent<HTMLImageElement>) => void
  /** The media's real width/height (docs/00 D32). When known, it's applied for
   *  the whole lifetime so the box is reserved exactly — zero reflow on load. */
  aspectRatio?: number | null
  /** placeholder ratio while loading, used only when the real ratio is unknown */
  defaultAspectRatio?: string
}) {
  const [loaded, setLoaded] = useState(false)
  const knownRatio =
    aspectRatio && Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : null
  // Known ratio → reserve the exact box always (no shift). Unknown → a
  // placeholder ratio holds space only until the image supplies its own.
  const aspectStyle = knownRatio
    ? { aspectRatio: String(knownRatio) }
    : loaded
      ? undefined
      : { aspectRatio: defaultAspectRatio }

  return (
    <span className={`relative block ${wrapperClassName}`}>
      {!loaded && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 animate-pulse rounded-[inherit] bg-surface-raised motion-reduce:animate-none"
        />
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        loading={loading}
        draggable={draggable}
        onClick={onClick}
        onLoad={() => setLoaded(true)}
        // A broken image should still clear the shimmer (no permanent pulse).
        onError={() => setLoaded(true)}
        // Stable state hook (not a styling class) so tests assert the fade
        // contract without pinning Tailwind opacity utilities.
        data-loaded={loaded}
        style={aspectStyle}
        className={`${className} ${
          loaded ? 'opacity-100' : 'opacity-0'
        } transition-opacity duration-500 motion-reduce:transition-none`}
      />
    </span>
  )
}
