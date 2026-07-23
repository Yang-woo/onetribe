/**
 * Live-signal dot — the wall live feed only
 * (docs/12 accent discipline). The pulse-dot keyframe lives in globals.css;
 * motion-reduce disables it. Decorative: aria-hidden, meaning comes from the
 * text beside it.
 */
export function PulseDot({ className = '' }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block h-[7px] w-[7px] shrink-0 rounded-full bg-orange animate-[pulse-dot_1.6s_ease-in-out_infinite] motion-reduce:animate-none ${className}`}
    />
  )
}
