/**
 * One Tribe logo mark — searchlight beam (docs/12-brand C, docs/00 D24).
 * Three stage beams converging on the crowd: back-to-front light,
 * "one tribe under the same beams". Geometry is fixed by the handoff
 * spec (viewBox 0 0 96 64, three non-overlapping polygons) — scale via
 * width/height/className only, never edit the points.
 *
 * Pure attribute-styled SVG on purpose: the same component renders in
 * the DOM (header) and inside satori (`next/og` cards), which ignores
 * CSS classes but honors fill attributes.
 */

const BEAM_FILLS = {
  /** Orange 3-step transparency — the default everywhere. */
  primary: ['rgba(255,106,0,.35)', 'rgba(255,106,0,.7)', '#ff6a00'],
  /** Red mix — emphasis contexts (events, posters). */
  secondary: ['#e3241d', '#ff6a00', '#ff9a4d'],
  /** Single-color for print/watermark/low-contrast backgrounds. */
  'mono-light': ['rgba(242,237,230,.35)', 'rgba(242,237,230,.7)', '#f2ede6'],
  'mono-black': ['rgba(11,9,8,.35)', 'rgba(11,9,8,.7)', '#0b0908'],
} as const

export type LogoVariant = keyof typeof BEAM_FILLS

export function LogoMark({
  variant = 'primary',
  width,
  height,
  className,
}: {
  variant?: LogoVariant
  width?: number
  height?: number
  className?: string
}) {
  const [left, center, right] = BEAM_FILLS[variant]
  return (
    <svg viewBox="0 0 96 64" width={width} height={height} className={className} aria-hidden="true">
      <polygon points="44,64 4,0 16,0 52,64" fill={left} />
      <polygon points="52,64 40,0 52,0 60,64" fill={center} />
      <polygon points="60,64 80,0 92,0 68,64" fill={right} />
    </svg>
  )
}
