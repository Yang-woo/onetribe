/**
 * Generate machine translations of the policy + about copy into every locale,
 * for the multilingual "all languages stacked" policy pages (docs/00 D18).
 *
 * English is the BINDING original; the non-EN entries are DeepL machine
 * translations, reviewed once by hand and committed. This is a build-time
 * generator, not a runtime path — legal text should be reviewed and versioned,
 * never translated live. After editing policy-content.ts:
 *
 *   set -a; source .env.local; set +a; npx tsx scripts/translate-policies.ts --patch
 *
 * (--patch = only the strings whose English changed. A bare run re-translates
 * everything and discards the hand review; see the --patch comment below.)
 *
 * (Uses DEEPL_API_KEY. Small volume — well within the Free 1M-char/month tier.)
 */
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { POLICIES, ABOUT, type PolicyDoc } from '../src/lib/policy-content'
import { LOCALES, DEFAULT_LOCALE } from '../src/lib/locales'
import { createDeeplProvider } from '../src/lib/translate/deepl'

interface LocalizedDoc {
  title: string
  sections: { heading?: string; paragraphs: string[] }[]
}

const key = process.env.DEEPL_API_KEY
if (!key) throw new Error('DEEPL_API_KEY missing — run: set -a; source .env.local; set +a')

const deepl = createDeeplProvider(key)
const targets = LOCALES.filter((l) => l !== DEFAULT_LOCALE)
const slugs = Object.keys(POLICIES) as PolicyDoc['slug'][]

// `--only-missing`: keep already-translated locales verbatim and only DeepL the
// ones missing (or structurally stale) in the committed file. Use this when
// ADDING a locale, so the existing reviewed translations aren't re-machined
// (and the Free quota isn't spent) needlessly.
const onlyMissing = process.argv.includes('--only-missing')

// `--patch`: re-translate only the STRINGS THAT CHANGED, keeping every other
// locale string byte-for-byte. Use this when editing existing policy copy.
//
// Why this mode exists: the committed non-EN text was machine-translated once
// and then reviewed BY HAND — roughly 250 strings of it (D18/D19). A full regen
// after a one-paragraph edit throws all of that away and silently replaces it
// with fresh DeepL output, and no test can tell the difference because both are
// "a translation". The committed EN entry is the record of what the current
// translations were made from, so comparing it against policy-content.ts says
// exactly which strings went stale — nothing else needs re-machining.
//
// Alignment is by index, so a section whose paragraph COUNT changed cannot be
// matched up string-by-string; that section is re-translated whole. Everything
// re-translated is printed, because that list is the hand-review surface.
const patch = process.argv.includes('--patch')
if (patch && onlyMissing) throw new Error('--patch and --only-missing are different jobs; pick one')

/** One translator per locale, memoized — identical strings (contact lines) hit once. */
function makeTranslator(locale: string) {
  const cache = new Map<string, string>()
  return async (s: string): Promise<string> => {
    const hit = cache.get(s)
    if (hit !== undefined) return hit
    const { text } = await deepl.translate(s, locale, 'en')
    cache.set(s, text)
    return text
  }
}

async function translateDoc(
  doc: PolicyDoc,
  tr: (s: string) => Promise<string>,
): Promise<LocalizedDoc> {
  const title = await tr(doc.title)
  const sections: LocalizedDoc['sections'] = []
  for (const sec of doc.sections) {
    const paragraphs: string[] = []
    for (const p of sec.paragraphs) paragraphs.push(await tr(p))
    sections.push(sec.heading ? { heading: await tr(sec.heading), paragraphs } : { paragraphs })
  }
  return { title, sections }
}

/**
 * Re-translate only what changed. `priorEn` is the EN text the committed
 * `priorLoc` was made from; anything still identical to it is kept verbatim.
 *
 * A shape mismatch anywhere (section count, or a paragraph count inside one
 * section) means index alignment would compare unrelated strings, so that unit
 * falls back to a full translation rather than guessing which paragraph moved.
 */
async function patchDoc(
  doc: PolicyDoc,
  priorEn: LocalizedDoc | undefined,
  priorLoc: LocalizedDoc | undefined,
  tr: (s: string) => Promise<string>,
  note: (what: string, strings?: number) => void,
): Promise<LocalizedDoc> {
  const alignable =
    priorEn &&
    priorLoc &&
    priorEn.sections.length === doc.sections.length &&
    priorLoc.sections.length === doc.sections.length
  if (!alignable) {
    // Counted, not listed as one line: this branch is the single largest loss
    // the tool can inflict, and a report of "1" would hide it behind the
    // smallest possible number.
    const strings =
      1 + doc.sections.reduce((n, s) => n + (s.heading ? 1 : 0) + s.paragraphs.length, 0)
    note(`${doc.slug}: whole doc, ${strings} strings (no aligned prior)`, strings)
    return translateDoc(doc, tr)
  }

  const keepOrTranslate = async (
    next: string,
    was: string | undefined,
    had: string | undefined,
    what: string,
  ) => {
    if (was === next && had !== undefined) return had
    note(what)
    return tr(next)
  }

  const title = await keepOrTranslate(
    doc.title,
    priorEn.title,
    priorLoc.title,
    `${doc.slug}: title`,
  )
  const sections: LocalizedDoc['sections'] = []
  for (const [i, sec] of doc.sections.entries()) {
    const wasSec = priorEn.sections[i]
    const hadSec = priorLoc.sections[i]
    const aligned =
      sec.paragraphs.length === wasSec.paragraphs.length &&
      sec.paragraphs.length === hadSec.paragraphs.length
    const paragraphs: string[] = []
    for (const [j, para] of sec.paragraphs.entries()) {
      paragraphs.push(
        aligned
          ? await keepOrTranslate(
              para,
              wasSec.paragraphs[j],
              hadSec.paragraphs[j],
              `${doc.slug} §${i + 1}[${j}]`,
            )
          : (note(`${doc.slug} §${i + 1}[${j}] (paragraph count changed)`), await tr(para)),
      )
    }
    if (sec.heading === undefined) {
      sections.push({ paragraphs })
      continue
    }
    const heading = await keepOrTranslate(
      sec.heading,
      wasSec.heading,
      hadSec.heading,
      `${doc.slug} §${i + 1} heading`,
    )
    sections.push({ heading, paragraphs })
  }
  return { title, sections }
}

/** EN entry = the original, stripped to LocalizedDoc shape (drop `slug`). */
function stripDoc(doc: PolicyDoc): LocalizedDoc {
  return {
    title: doc.title,
    sections: doc.sections.map((s) =>
      s.heading ? { heading: s.heading, paragraphs: s.paragraphs } : { paragraphs: s.paragraphs },
    ),
  }
}

async function main() {
  const policyOut: Record<string, Record<string, LocalizedDoc>> = {
    [DEFAULT_LOCALE]: Object.fromEntries(slugs.map((s) => [s, stripDoc(POLICIES[s])])),
  }
  const aboutOut: Record<string, { title: string; paragraphs: string[] }> = {
    [DEFAULT_LOCALE]: { title: ABOUT.title, paragraphs: [...ABOUT.paragraphs] },
  }
  /** --patch: how many strings the run actually re-machined, across all locales. */
  let patched = 0

  // For --only-missing, load the committed translations to reuse where complete.
  let priorPolicy: Record<string, Record<string, LocalizedDoc>> = {}
  let priorAbout: Record<string, { title: string; paragraphs: string[] }> = {}
  if (onlyMissing || patch) {
    const mod = await import('../src/lib/policy-content-i18n')
    priorPolicy = mod.POLICY_I18N as unknown as typeof priorPolicy
    priorAbout = mod.ABOUT_I18N as unknown as typeof priorAbout
  }

  // --only-missing reuses a locale on section-count SHAPE alone, while the EN
  // entry is rewritten from source on every run. Run it after editing copy and
  // the baseline silently advances past translations that were never redone:
  // the committed EN then matches the source, so a later --patch reports
  // "nothing changed" for all 16 locales and the stale legal text becomes
  // unreachable through the documented workflow. Tests do not see it either —
  // the EN entry is verbatim and the copy check only samples one paragraph.
  if (onlyMissing) {
    const enChanged =
      slugs.some(
        (slug) =>
          JSON.stringify(priorPolicy[DEFAULT_LOCALE]?.[slug]) !==
          JSON.stringify(stripDoc(POLICIES[slug])),
      ) ||
      JSON.stringify(priorAbout[DEFAULT_LOCALE]) !==
        JSON.stringify({ title: ABOUT.title, paragraphs: [...ABOUT.paragraphs] })
    if (enChanged) {
      throw new Error(
        'policy-content.ts has moved past the committed translations — run --patch first.\n' +
          '--only-missing would advance the EN baseline without re-translating the edited\n' +
          'strings, and no later run could tell they were stale.',
      )
    }
  }

  // --patch keeps the committed locale ORDER too. LOCALES has been reordered
  // since the last full regen, so emitting in LOCALES order would rewrite the
  // whole file — 645 moved lines around 51 real ones, on the one kind of change
  // (binding legal copy) where the diff is what a reviewer reads.
  const priorOrder = Object.keys(priorPolicy)
  const rank = (l: (typeof targets)[number]) => {
    const i = priorOrder.indexOf(l)
    return i < 0 ? priorOrder.length + targets.indexOf(l) : i
  }
  const sequence = patch ? [...targets].sort((a, b) => rank(a) - rank(b)) : targets

  for (const locale of sequence) {
    // Reuse an existing locale only if it carries every doc + about at the
    // current section shape — a shape mismatch means policy-content.ts moved on
    // and this locale must be re-translated even under --only-missing.
    const pDocs = priorPolicy[locale]
    const pAbout = priorAbout[locale]
    const complete =
      onlyMissing &&
      pDocs &&
      pAbout &&
      slugs.every((s) => pDocs[s]?.sections?.length === POLICIES[s].sections.length) &&
      pAbout.paragraphs?.length === ABOUT.paragraphs.length
    if (complete) {
      process.stderr.write(`keeping ${locale} (already translated)\n`)
      policyOut[locale] = pDocs
      aboutOut[locale] = pAbout
      continue
    }
    const tr = makeTranslator(locale)

    if (patch) {
      const changed: string[] = []
      let strings = 0
      const note = (what: string, n = 1) => {
        changed.push(what)
        strings += n
      }
      const priorEnDocs = priorPolicy[DEFAULT_LOCALE]
      const docs: Record<string, LocalizedDoc> = {}
      for (const slug of slugs) {
        docs[slug] = await patchDoc(POLICIES[slug], priorEnDocs?.[slug], pDocs?.[slug], tr, note)
      }
      policyOut[locale] = docs

      const priorEnAbout = priorAbout[DEFAULT_LOCALE]
      const alignedAbout =
        priorEnAbout &&
        pAbout &&
        priorEnAbout.paragraphs.length === ABOUT.paragraphs.length &&
        pAbout.paragraphs.length === ABOUT.paragraphs.length
      const paragraphs: string[] = []
      for (const [i, para] of ABOUT.paragraphs.entries()) {
        if (alignedAbout && priorEnAbout.paragraphs[i] === para) {
          paragraphs.push(pAbout.paragraphs[i])
          continue
        }
        note(`about[${i}]`)
        paragraphs.push(await tr(para))
      }
      const title =
        priorEnAbout?.title === ABOUT.title && pAbout
          ? pAbout.title
          : (note('about: title'), await tr(ABOUT.title))
      aboutOut[locale] = { title, paragraphs }

      patched += strings
      process.stderr.write(
        strings
          ? `${locale}: re-translated ${strings} — ${changed.join(', ')}\n`
          : `${locale}: nothing changed\n`,
      )
      continue
    }

    process.stderr.write(`translating ${locale}…\n`)
    const docs: Record<string, LocalizedDoc> = {}
    for (const slug of slugs) docs[slug] = await translateDoc(POLICIES[slug], tr)
    policyOut[locale] = docs
    const paragraphs: string[] = []
    for (const p of ABOUT.paragraphs) paragraphs.push(await tr(p))
    aboutOut[locale] = { title: await tr(ABOUT.title), paragraphs }
  }

  const header = `// GENERATED by scripts/translate-policies.ts — DO NOT EDIT BY HAND except
// for reviewed accuracy fixes. English is the binding original (docs/00 D18);
// non-EN entries are DeepL machine translations, reviewed once by hand.
//
// After editing policy copy, regenerate with --patch: it re-machines only the
// strings whose English actually changed and keeps the rest byte-for-byte.
//   set -a; source .env.local; set +a; npx tsx scripts/translate-policies.ts --patch
// A bare run re-translates EVERY string and throws away ~250 hand-reviewed ones
// (docs/00 D18/D19) with nothing to show for it — no test can see the loss,
// because machine output and reviewed output are both \"a translation\".
// --only-missing is for ADDING a locale.
import type { Locale } from './locales'
import type { PolicyDoc } from './policy-content'

export interface LocalizedDoc {
  title: string
  sections: { heading?: string; paragraphs: string[] }[]
}

export const POLICY_I18N: Record<Locale, Record<PolicyDoc['slug'], LocalizedDoc>> =
${JSON.stringify(policyOut, null, 2)}

export const ABOUT_I18N: Record<Locale, { title: string; paragraphs: string[] }> =
${JSON.stringify(aboutOut, null, 2)}
`

  const outPath = path.join(process.cwd(), 'src/lib/policy-content-i18n.ts')
  writeFileSync(outPath, header)
  process.stderr.write(`\nwrote ${outPath}\n`)
  if (patch) {
    process.stderr.write(
      `patched ${patched} string(s) across ${targets.length} locales — review each one by hand before committing\n`,
    )
  }
}

main().catch((e) => {
  process.stderr.write(String(e) + '\n')
  process.exit(1)
})
