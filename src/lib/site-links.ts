/**
 * The site's policy/info links, in the one order both entry points render:
 * the footer at the end of a page, and the wall's info button (docs/00 D51).
 * Two hand-kept lists would drift, and the one that drifts is the one nobody
 * scrolls far enough to notice. Labels live under `footer.links.*`.
 *
 * The donation link is deliberately NOT here — it enters only through About's
 * no-perk framing (D15), so both renderers add it themselves behind
 * `hasSupportLinks()`.
 */
export const FOOTER_LINKS = ['terms', 'privacy', 'takedown', 'guidelines', 'about'] as const
