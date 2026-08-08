/**
 * The site's policy links, in the one order both entry points render: the
 * footer at the end of a page, and the wall's info button (docs/00 D51).
 * Two hand-kept lists would drift. Labels live under `footer.links.*`.
 *
 * The donation link is deliberately NOT here — it enters only through About's
 * no-perk framing (D15), so both renderers add it themselves behind
 * `hasSupportLinks()` and `SUPPORT_ANCHOR`.
 */
export const SITE_LINKS = ['terms', 'privacy', 'takedown', 'guidelines', 'about'] as const
