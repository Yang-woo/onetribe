import { describe, expect, test } from 'vitest'
import { POLICY_I18N, ABOUT_I18N } from './policy-content-i18n'
import { POLICIES, ABOUT } from './policy-content'
import { LOCALES } from './locales'

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
