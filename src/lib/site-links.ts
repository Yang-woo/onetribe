/**
 * The site's policy links, in the one order both entry points render: the
 * footer at the end of a page, and the wall's info button (docs/00 D51).
 * Two hand-kept lists would drift. Labels live under `footer.links.*`.
 *
 * About leads. It is the only entry that says what this site is; the rest are
 * legal documents you go looking for. One order change moves it to both
 * places at once — leftmost in the footer, top of the panel.
 *
 * The donation link is deliberately NOT here — it enters only through About's
 * no-perk framing (D15), so both renderers add it themselves behind
 * `hasSupportLinks()` and `SUPPORT_ANCHOR`.
 */
export const SITE_LINKS = ['about', 'terms', 'privacy', 'takedown', 'guidelines'] as const

/**
 * The public source repository — the one link either renderer carries that
 * leaves the site, so it lives beside SITE_LINKS rather than in it: no locale
 * prefix applies, and it renders last in both (far right in the footer, under
 * a hairline at the bottom of the info panel).
 *
 * The label is deliberately not a message key. "GitHub" is a proper noun and
 * ships identically in all 17 locales, so a key would be 17 copies of one
 * string — and an English common noun ("source") next to translated labels
 * reads as a missing translation instead of a brand.
 */
export const SOURCE_LINK = {
  url: 'https://github.com/Yang-woo/onetribe',
  label: 'GitHub ↗',
} as const
