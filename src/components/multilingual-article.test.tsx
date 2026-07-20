import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
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
  test('renders the story in every language and one ko-fi link (D15/D18)', () => {
    const { container } = render(<AboutPage />)
    expect(container.querySelector('#lang-ko')).not.toBeNull()
    expect(container.querySelector('#lang-de')).not.toBeNull()

    const support = container.querySelector('#support')
    expect(support).not.toBeNull()
    const kofi = support?.querySelector('a[href="https://ko-fi.com/onetribeworld"]')
    expect(kofi).not.toBeNull()
    // one CTA, not one per language
    expect(container.querySelectorAll('a[href="https://ko-fi.com/onetribeworld"]').length).toBe(1)
  })
})
