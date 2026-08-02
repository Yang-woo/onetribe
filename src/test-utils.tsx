import { render } from '@testing-library/react'
import type { Moment } from '@/lib/moments'
import { NextIntlClientProvider } from 'next-intl'
import en from '../messages/en.json'

/**
 * The provider component tests run under — EN messages, same as production.
 * Exported because RTL's `rerender` replaces the whole tree: a test that
 * re-renders has to re-apply the provider, and doing that by hand is how the
 * two renders drift onto different intl config.
 */
export function withIntl(ui: React.ReactElement) {
  return (
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      {ui}
    </NextIntlClientProvider>
  )
}

export function renderWithIntl(ui: React.ReactElement) {
  return render(withIntl(ui))
}

/** Fully-populated Moment fixture — new schema columns get added here once. */
export function momentFixture(id: string, overrides: Partial<Moment> = {}): Moment {
  return {
    id,
    event_id: 'event-1',
    media_url: `https://media.test/${id}.jpg`,
    thumb_url: null,
    media_kind: 'image',
    embed_url: null,
    clip_start: null,
    clip_length: null,
    caption: `caption-${id}`,
    source_lang: null,
    author_name: null,
    author_link: null,
    author_id: null,
    origin_country: null,
    aspect_ratio: null,
    status: 'live',
    created_at: '2026-07-12T00:00:00Z',
    ...overrides,
  }
}
