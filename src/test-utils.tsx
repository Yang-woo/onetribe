import { render } from '@testing-library/react'
import type { Moment } from '@/lib/moments'
import { NextIntlClientProvider } from 'next-intl'
import en from '../messages/en.json'

/** Component tests run under the EN messages — same provider as production. */
export function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      {ui}
    </NextIntlClientProvider>,
  )
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
