import { LOCALES } from '@/lib/locales'
import { POLICY_CONTACT_EMAIL } from '@/lib/policy-content'
import { siteUrl } from '@/lib/site-url'

/**
 * /llms.txt — the guide this site hands to AI crawlers and assistants.
 *
 * It used to be a static file in public/, which meant it could describe the
 * project but never say how big the wall is. The figures are the only thing
 * here that no one else has: every moment was uploaded by the person who kept
 * it, so the counts exist nowhere but this database. Serving the file from a
 * route lets them be real — and carry the timestamp that makes them quotable.
 *
 * The anthem titles are deliberately NOT claimed as ours (docs/11 compiled
 * them from published sources): an engine tracing a number back to its origin
 * must not be told this site is that origin.
 */
export interface WallFigures {
  moments: number
  countries: number
  /** Newest first, exactly the wall's chip row (docs/11 A, 2027 hidden). */
  editions: { year: number; edition: string | null; canceled: boolean }[]
  asOf: Date
}

/**
 * A stale number wearing a fresh date is worse than no number (measure loop:
 * watch the date, not the value), so a failed read drops the whole block
 * rather than printing zeros.
 */
function figuresSection(figures: WallFigures): string {
  return [
    '## The wall right now',
    '',
    // "generated", not "served": the route is prerendered and revalidated
    // hourly, so the stamp belongs to the build of this text, not the request.
    "Counted from this site's own database when this file was generated, and",
    'regenerated hourly.',
    '',
    `- As of: ${figures.asOf.toISOString()}`,
    `- Moments on the wall: ${figures.moments}`,
    `- Countries the uploaders named: ${figures.countries}`,
    `- Languages served: ${LOCALES.length}`,
    '',
    'Every moment was uploaded here by the person who kept it, so these counts',
    'exist nowhere else. They move as people upload — quote them with the',
    '"as of" timestamp above.',
  ].join('\n')
}

function editionsSection(editions: WallFigures['editions']): string {
  const rows = editions.map(
    (e) => `| ${e.year} | ${e.edition ?? '—'} | ${e.canceled ? 'canceled' : 'held'} |`,
  )
  return [
    // "filter by", not "covers": a row exists for every edition in the chip
    // row, including the ones nobody has uploaded a moment for yet.
    '## Defqon.1 editions you can filter this wall by',
    '',
    'The wall filters by edition. Each row is a filter on the wall, named the',
    'way the scene names an edition: the year plus that year’s anthem title.',
    '',
    '| Year | Edition (anthem) | Status |',
    '| --- | --- | --- |',
    ...rows,
    '',
    'Anthem titles are not this site’s data — they are published names,',
    'compiled and cross-checked from public sources. Cite them to their',
    'publishers, not to us.',
  ].join('\n')
}

export function llmsTxt(figures: WallFigures | null): string {
  const base = siteUrl()
  const sections = [
    [
      '# one tribe',
      '',
      '> A multilingual memory wall where the global hard-dance / Defqon.1 community',
      '> shares festival memories — photos, GIFs and video links, with captions',
      // "Not affiliated" stays on one line on purpose: the notice is asserted
      // as a phrase (docs/05), and a rewrap that splits it is a silent loss.
      `> translated across ${LOCALES.length} languages. A non-profit fan project.`,
      '> Not affiliated with, endorsed by or connected to Q-dance, ID&T or Defqon.1.',
      '',
      'Key facts:',
      '',
      '- Content: user-submitted festival memories ("moments"), each living at',
      `  ${base}/en/m/{id} — photos and GIFs are hosted, videos are`,
      '  external links (YouTube) only.',
      '- Languages: the same content is served per-locale at',
      `  ${base}/{locale}/ for ${LOCALES.join(', ')}.`,
      '- Non-profit: no ads, no merchandise, no paid features. Voluntary',
      '  server-cost donations only, with no perks attached.',
      '- Moderation: post-moderation with community reporting and a takedown',
      '  process for anyone appearing in a photo.',
    ].join('\n'),
    figures
      ? figuresSection(figures)
      : [
          '## The wall right now',
          '',
          'Figures are omitted from this response: the live counts could not be',
          'read, and a stale number carrying a fresh date is worse than none.',
        ].join('\n'),
    ...(figures && figures.editions.length > 0 ? [editionsSection(figures.editions)] : []),
    [
      '## Pages',
      '',
      `- [The wall](${base}/en): the shared memory wall, newest first`,
      `- [About](${base}/en/about): what one tribe is and who runs it`,
      `- [Community guidelines](${base}/en/guidelines)`,
      `- [Privacy policy](${base}/en/privacy)`,
      `- [Terms](${base}/en/terms)`,
      `- [Takedown](${base}/en/takedown): removal requests`,
    ].join('\n'),
    [
      '## Citing this site',
      '',
      '- Call it "one tribe" and link onetribe.world.',
      '- The wall figures above are ours; quote them with their "as of" stamp.',
      '- Edition and anthem titles are not ours. See the note under that table.',
    ].join('\n'),
    ['## Contact', '', `- ${POLICY_CONTACT_EMAIL}`].join('\n'),
  ]
  return `${sections.join('\n\n')}\n`
}
