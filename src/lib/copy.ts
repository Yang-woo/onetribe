/**
 * User-facing copy, EN only for now — centralized so the W3 next-intl
 * migration (docs/17 T3.6) is a mechanical move into locale files.
 * Hero/subcopy wording comes from docs/08 B. Never use "Forever One Tribe"
 * (Q-dance's official motto — docs/12 A hard rule).
 */
export const copy = {
  siteName: 'one tribe',
  hero: {
    title: 'This year, the weekend never happened.',
    body: 'So we’re building it from memory — every Defqon, every stage, every sunrise we ever took home. Add yours, in your own language.',
    cta: 'add your moment',
    counter: (moments: number, countries: number) =>
      `${moments} ${moments === 1 ? 'moment' : 'moments'} · ${countries} ${countries === 1 ? 'country' : 'countries'}`,
  },
  wall: {
    allEditions: 'all',
    lostEditionChip: (year: number) => `${year} — the weekend that never happened`,
    emptyTitle: 'the wall is waking up',
    emptyBody: 'be one of the first to leave a moment here.',
    loadMore: 'more moments',
  },
  footer: {
    disclaimer:
      'Unofficial fan project — not affiliated with, endorsed by, or connected to Q-dance / Defqon.1.',
    links: [
      { href: '/terms', label: 'terms' },
      { href: '/privacy', label: 'privacy' },
      { href: '/takedown', label: 'takedown' },
      { href: '/guidelines', label: 'guidelines' },
      { href: '/about', label: 'about' },
    ],
  },
} as const
