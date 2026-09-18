import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { PolicyArticle } from './policy-article'
import AboutPage from '@/app/[locale]/about/page'
import { POLICIES } from '@/lib/policy-content'
import { LOCALES, LOCALE_NAMES } from '@/lib/locales'

/**
 * docs/00 D18 — the stacked "manual" layout. Same output for any URL locale,
 * so these render without an intl provider (the components take no locale).
 */
describe('PolicyArticle — every language stacked', () => {
  test('renders one lang-tagged block per locale + the binding note', () => {
    const { container } = render(<PolicyArticle doc={POLICIES.terms} />)

    expect(screen.getByText(/English is the binding version/i)).toBeInTheDocument()

    for (const locale of LOCALES) {
      const block = container.querySelector(`#lang-${locale}`)
      expect(block, locale).not.toBeNull()
      expect(block?.getAttribute('lang'), `${locale} lang attr`).toBe(locale)
    }
    // language jump-nav lists every endonym
    for (const locale of LOCALES) {
      expect(screen.getAllByText(LOCALE_NAMES[locale]).length, locale).toBeGreaterThan(0)
    }
  })

  test('translated content lands in the right language block', () => {
    const { container } = render(<PolicyArticle doc={POLICIES.terms} />)
    expect(container.querySelector('#lang-ko')?.textContent).toContain('이용약관')
    expect(container.querySelector('#lang-en')?.textContent).toContain('Terms of Service')
  })
})

describe('About page — stacked story + single support CTA', () => {
  beforeEach(() => vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://onetribe.world'))
  afterEach(() => vi.unstubAllEnvs())

  // The page reads the URL locale now (for its structured data), so it awaits
  // params like any other server component — call it, then render what it gave.
  const about = async (locale: string) =>
    render(await AboutPage({ params: Promise.resolve({ locale }) }))

  test('renders the story in every language and one ko-fi link (D15/D18)', async () => {
    const { container } = await about('en')
    expect(container.querySelector('#lang-ko')).not.toBeNull()
    expect(container.querySelector('#lang-de')).not.toBeNull()

    const support = container.querySelector('#support')
    expect(support).not.toBeNull()
    const kofi = support?.querySelector('a[href="https://ko-fi.com/onetribeworld"]')
    expect(kofi).not.toBeNull()
    // one CTA, not one per language
    expect(container.querySelectorAll('a[href="https://ko-fi.com/onetribeworld"]').length).toBe(1)
  })

  // Wiring, not shape: lib/seo builds the node, but only this catches the page
  // never rendering it — the gap D59's test review found the first time round.
  test('emits its structured data, tied to the one declared organization', async () => {
    const { container } = await about('ko')
    const script = container.querySelector('script[type="application/ld+json"]')
    expect(script, 'the about page rendered no structured data').not.toBeNull()
    const data = JSON.parse(script!.textContent!.replace(/\\u003c/g, '<'))
    expect(data['@type']).toBe('AboutPage')
    expect(data.url).toBe('https://onetribe.world/ko/about')
    expect(data.name).toBe('소개')
    expect(data.mainEntity).toEqual({ '@id': 'https://onetribe.world/#organization' })
  })

  test('an unknown locale falls back to English rather than a broken node', async () => {
    const { container } = await about('xx')
    const script = container.querySelector('script[type="application/ld+json"]')
    const data = JSON.parse(script!.textContent!.replace(/\\u003c/g, '<'))
    expect(data.url).toBe('https://onetribe.world/en/about')
    expect(data.inLanguage).toBe('en')
  })
})
