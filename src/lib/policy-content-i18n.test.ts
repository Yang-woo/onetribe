import { describe, expect, test } from 'vitest'
import { POLICY_I18N, ABOUT_I18N } from './policy-content-i18n'
import { POLICIES, ABOUT, type PolicyDoc } from './policy-content'
import { LOCALES, type Locale } from './locales'

/**
 * docs/00 D18 — policy pages show every language stacked. These guard the
 * generated translation data: a broken regen (dropped locale, dropped section,
 * EN copied through, or a lost brand/contact/disclaimer) must fail here.
 */
const slugs = Object.keys(POLICIES) as (keyof typeof POLICIES)[]

describe('policy i18n data', () => {
  test('every locale carries every doc + about, with the source section shape', () => {
    for (const locale of LOCALES) {
      expect(POLICY_I18N[locale], locale).toBeDefined()
      for (const slug of slugs) {
        const doc = POLICY_I18N[locale][slug]
        expect(doc?.title, `${locale}/${slug} title`).toBeTruthy()
        expect(doc.sections.length, `${locale}/${slug} section count`).toBe(
          POLICIES[slug].sections.length,
        )
      }
      expect(ABOUT_I18N[locale].paragraphs.length, `${locale} about paras`).toBe(
        ABOUT.paragraphs.length,
      )
    }
  })

  test('EN entry is the binding source verbatim', () => {
    for (const slug of slugs) {
      expect(POLICY_I18N.en[slug].title).toBe(POLICIES[slug].title)
      expect(POLICY_I18N.en[slug].sections.flatMap((s) => s.paragraphs)).toEqual(
        POLICIES[slug].sections.flatMap((s) => s.paragraphs),
      )
    }
    expect(ABOUT_I18N.en.paragraphs).toEqual([...ABOUT.paragraphs])
  })

  test('non-EN locales are actually translated, not the EN text copied', () => {
    const en = POLICY_I18N.en.terms.sections[0].paragraphs[0]
    for (const locale of LOCALES) {
      if (locale === 'en') continue
      expect(POLICY_I18N[locale].terms.sections[0].paragraphs[0], locale).not.toBe(en)
    }
  })

  test('brand, contact inbox, and the not-affiliated disclaimer survive every translation', () => {
    for (const locale of LOCALES) {
      const terms = JSON.stringify(POLICY_I18N[locale].terms)
      expect(terms, `${locale} brand`).toContain('One Tribe')
      expect(terms, `${locale} disclaimer`).toContain('Q-dance')
      expect(JSON.stringify(POLICY_I18N[locale].privacy), `${locale} contact`).toContain(
        'privacy@onetribe.world',
      )
    }
  })
})

/**
 * D54 gave uploaders a route that does not depend on the deletion link, and
 * this copy is what tells them it exists — read, by definition, by people who
 * lost the link. So the route has to be named in a word they recognise.
 *
 * The machine translation did not do that on its own: it left "Passport"
 * untranslated in fourteen locales and turned it into an app ("z aplikacji
 * Passport") in a fifteenth, while every UI and the reviewed §4 body call it by
 * the local word. This table is that hand review, held in place from both ends
 * — the policy text must use the word, and the word must still be the one the
 * app's own passport page shows.
 */
const PASSPORT_WORD: Record<Locale, string> = {
  en: 'Passport',
  nl: 'paspoort',
  de: 'Pass',
  es: 'pasaporte',
  fr: 'passeport',
  it: 'passaporto',
  pt: 'passaporte',
  pl: 'paszpor', // stem: the locative is "paszporcie", which drops the t
  sv: 'pass',
  tr: 'pasaport',
  id: 'paspor',
  th: 'พาสปอร์ต',
  vi: 'hộ chiếu',
  zh: '护照',
  'zh-Hant': '護照',
  ja: 'パスポート',
  ko: '여권',
}

/**
 * Two languages name it with a word that is also a fragment of common ones —
 * German "angepasst", "passiert"; Swedish "anpassa", "passar". A plain
 * substring check would let a regen that dropped the reference pass on any of
 * them, so those two are matched as whole words instead.
 */
const IN_COPY: Partial<Record<Locale, RegExp>> = {
  de: /\bPass\b/i,
  sv: /\bpass(et)?\b/i,
}

describe('the way out of a lost deletion link (D54)', () => {
  /** By heading, not by index — a reordered doc should fail loudly, not silently pass. */
  const at = (slug: keyof typeof POLICIES, heading: string, paragraph: number) => {
    const section = POLICIES[slug].sections.findIndex((s) => s.heading === heading)
    expect(section, `${slug} lost its "${heading}" section`).toBeGreaterThanOrEqual(0)
    return (locale: Locale) => POLICY_I18N[locale][slug].sections[section].paragraphs[paragraph]
  }
  const places = [
    ['takedown', at('takedown', 'You uploaded it and want it gone?', 0)],
    ['terms §2', at('terms', '2. Your content', 1)],
    ['privacy §4', at('privacy', '4. Your rights (GDPR)', 0)],
  ] as const

  test.each(LOCALES)('%s points at the passport in its own words', async (locale) => {
    const word = PASSPORT_WORD[locale].toLowerCase()
    const ui = (await import(`../../messages/${locale}.json`)).default.passport.title
    expect(ui.toLowerCase(), `${locale}: table drifted from the passport page`).toContain(word)
    const inCopy = IN_COPY[locale]
    for (const [where, pick] of places) {
      if (inCopy) expect(pick(locale), `${locale} ${where}`).toMatch(inCopy)
      else expect(pick(locale).toLowerCase(), `${locale} ${where}`).toContain(word)
    }
  })

  test.each(LOCALES.filter((l) => l !== 'en'))('%s does not leave it in English', (locale) => {
    // 'Pass' is a substring of 'Passport', so the check above alone would let a
    // German regen keep the English name. None of the localized words contain it.
    for (const [where, pick] of places) {
      expect(pick(locale), `${locale} ${where}`).not.toMatch(/passport/i)
    }
  })
})

/**
 * One defined term per contract. Japanese carried three names for it at once —
 * 「メモリー」 in the ToS §2 definition, 「思い出」 in privacy, 「Memory」 in ToS §4 —
 * and Thai the same, which is how a term ends up defined in one clause and
 * never used again. Checking every place the term appears (not one sample) is
 * what makes a split fail: a locale that renames it in one clause loses it in
 * the others.
 */
const MEMORY_WORD: Record<Locale, string> = {
  en: 'Memor',
  nl: 'Herinnering',
  de: 'Erinnerung',
  es: 'Recuerdo',
  fr: 'Souvenir',
  it: 'Ricord',
  pt: 'Memór',
  pl: 'spomnie', // stem: Wspomnienie / Wspomnienia / wspomnień
  sv: 'Minne',
  tr: 'Anı',
  id: 'Memor',
  th: 'ความทรงจำ',
  vi: 'Ký ức',
  zh: '回忆',
  'zh-Hant': '回憶',
  ja: '思い出',
  ko: '메모리',
}

describe('one name for a Memory, in every clause that names it', () => {
  const PLACES: [PolicyDoc['slug'], string, number][] = [
    ['terms', '2. Your content', 0],
    ['terms', '2. Your content', 1],
    ['terms', '4. Moderation', 0],
    ['privacy', '2. What we collect', 0],
    ['privacy', '6. Retention', 0],
  ]

  test.each(LOCALES)('%s uses one word throughout', (locale) => {
    const word = MEMORY_WORD[locale].toLowerCase()
    for (const [slug, heading, paragraph] of PLACES) {
      const index = POLICIES[slug].sections.findIndex((s) => s.heading === heading)
      expect(index, `${slug} lost its "${heading}" section`).toBeGreaterThanOrEqual(0)
      const text = POLICY_I18N[locale][slug].sections[index].paragraphs[paragraph]
      expect(text.toLowerCase(), `${locale} ${slug} "${heading}" ¶${paragraph}`).toContain(word)
    }
  })
})
