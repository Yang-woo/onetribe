import { screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { momentFixture, renderWithIntl } from '@/test-utils'
import { AuthorTag } from './author-tag'

// docs/00 D30 — display name and Instagram handle are distinct: the @ only ever
// prefixes the real handle (from author_link), never the display name.

describe('AuthorTag', () => {
  test('name present + handle → the name, linked; visible name leads the accessible name (WCAG 2.5.3)', () => {
    renderWithIntl(
      <AuthorTag
        moment={momentFixture('a', {
          author_name: 'yann',
          author_link: 'https://instagram.com/lee_yangwoo',
        })}
      />,
    )
    // The visible text ("yann") must be part of the accessible name — the old
    // "Instagram @lee_yangwoo" label dropped it entirely (a 2.5.3 violation, so
    // speech-input "click yann" couldn't reach the link). The handle now only
    // trails as context.
    const link = screen.getByRole('link', { name: 'yann — Instagram @lee_yangwoo' })
    expect(link).toHaveTextContent('yann')
    expect(link).not.toHaveTextContent('@')
    expect(link).toHaveAttribute('href', 'https://instagram.com/lee_yangwoo')
  })

  test('name present, no handle → plain name, no link', () => {
    renderWithIntl(
      <AuthorTag moment={momentFixture('a', { author_name: 'yann', author_link: null })} />,
    )
    expect(screen.getByText('yann')).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  test('no name but a handle → @handle, linked', () => {
    renderWithIntl(
      <AuthorTag
        moment={momentFixture('a', {
          author_name: null,
          author_link: 'https://instagram.com/lee_yangwoo',
        })}
      />,
    )
    const link = screen.getByRole('link', { name: 'Instagram @lee_yangwoo' })
    expect(link).toHaveTextContent('@lee_yangwoo')
  })

  test('neither → anonymous', () => {
    renderWithIntl(
      <AuthorTag moment={momentFixture('a', { author_name: null, author_link: null })} />,
    )
    expect(screen.getByText('anonymous')).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})
