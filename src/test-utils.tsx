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

/**
 * A stand-in IntersectionObserver that honours `disconnect()`, so a test can
 * drive "the sentinel came into view" and still see teardown — an observer the
 * component has torn down stops firing, which is the only way to observe a cap
 * that works by disconnecting (docs/00 D51).
 *
 * `fireAll()` intersects every observer still alive; components that keep one
 * at a time therefore see exactly one callback. Call `restore()` in a finally.
 */
export function installIntersectionObserver(): { fireAll: () => void; restore: () => void } {
  const alive = new Map<object, () => void>()
  const real = globalThis.IntersectionObserver
  globalThis.IntersectionObserver = class {
    constructor(cb: IntersectionObserverCallback) {
      const self = this as unknown as IntersectionObserver
      alive.set(this, () => cb([{ isIntersecting: true } as IntersectionObserverEntry], self))
    }
    observe() {}
    unobserve() {}
    disconnect() {
      alive.delete(this)
    }
    takeRecords() {
      return []
    }
    root = null
    rootMargin = ''
    thresholds = []
  } as unknown as typeof IntersectionObserver

  return {
    // Snapshot first: a callback that synchronously constructs a replacement
    // observer would otherwise be swept up in the same pass and deliver two
    // callbacks for one "scroll".
    fireAll: () => [...alive.values()].forEach((fire) => fire()),
    restore: () => {
      // jsdom has no IntersectionObserver, so `real` is undefined there —
      // assigning it back would leave the global present-but-undefined and
      // flip `in`-style feature detection to true.
      if (real === undefined)
        delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver
      else globalThis.IntersectionObserver = real
    },
  }
}
