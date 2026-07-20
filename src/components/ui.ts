/**
 * Shared class recipes (docs/12 is the visual SSOT). Only truly identical
 * shapes live here — button variants differ in sizing/state on purpose.
 */

/** Text input / select / textarea. */
export const inputClass =
  'rounded-lg border border-line bg-surface px-3 py-2 text-paper placeholder:text-muted'

/** Outline pill for secondary actions — hover shifts to orange. */
export const secondaryButtonClass =
  'rounded-full border border-line px-4 py-2 text-sm text-paper transition-colors hover:border-orange hover:text-orange disabled:opacity-50'
