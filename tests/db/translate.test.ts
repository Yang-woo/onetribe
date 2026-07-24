import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createDeeplProvider } from '@/lib/translate/deepl'
import { captionHash, translateWithCache, type TranslationProvider } from '@/lib/translate'
import { createTranslateHandler } from '@/server/translate'
import { createAnonClient, createServiceClient, eventIdByYear, seedMemory } from './helpers'

/**
 * Translation cache rules straight from docs/16 D:
 * hit → no provider call · miss → call once + cache · failure → original
 * text, nothing cached · provider column recorded for A/B swaps.
 * Real Postgres cache, fake provider (external boundary — docs/00 D8).
 */

const db = createServiceClient()
const marker = randomUUID().slice(0, 8)
const hashes: string[] = []

function trackedText(text: string): string {
  const full = `${text} ${marker}`
  hashes.push(captionHash(full))
  return full
}

function fakeProvider(name = 'fake'): TranslationProvider & { calls: number } {
  const provider = {
    name,
    calls: 0,
    async translate(text: string, targetLang: string) {
      provider.calls += 1
      return { text: `[${name}:${targetLang}] ${text}`, detectedSourceLang: 'en' }
    },
  }
  return provider
}

const anon = createAnonClient()
const memIds: string[] = []

afterAll(async () => {
  await db.from('translations').delete().in('source_hash', hashes)
  if (memIds.length) await db.from('memories').delete().in('id', memIds)
})

function post(body: unknown): Request {
  return new Request('http://localhost/api/translate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('translateWithCache', () => {
  test('miss calls the provider once and caches with the provider name', async () => {
    const provider = fakeProvider('deepl-fake')
    const text = trackedText('the sunrise at the red stage')

    const first = await translateWithCache(db, provider, text, 'ko')
    expect(first).toEqual({ text: `[deepl-fake:ko] ${text}`, cached: false, failed: false })
    expect(provider.calls).toBe(1)

    const { data: row } = await db
      .from('translations')
      .select('text, provider')
      .eq('source_hash', captionHash(text))
      .eq('target_lang', 'ko')
      .single()
    expect(row!.provider).toBe('deepl-fake')
  })

  test('hit returns from cache without calling the provider', async () => {
    const provider = fakeProvider()
    const text = trackedText('weekend warriors coming home')

    await translateWithCache(db, provider, text, 'ja')
    const second = await translateWithCache(db, provider, text, 'ja')

    expect(second.cached).toBe(true)
    expect(provider.calls).toBe(1)
  })

  test('whitespace variants share one cache row (normalized hash)', async () => {
    const provider = fakeProvider()
    const text = trackedText('kick   pulse')
    await translateWithCache(db, provider, text, 'de')
    await translateWithCache(db, provider, `  ${text.replace('   ', ' \n ')}  `, 'de')
    expect(provider.calls).toBe(1)
  })

  test('provider failure returns the original text and caches nothing', async () => {
    const failing: TranslationProvider = {
      name: 'down',
      translate: async () => {
        throw new Error('boom')
      },
    }
    const text = trackedText('never a blank screen')

    const result = await translateWithCache(db, failing, text, 'fr')
    expect(result).toEqual({ text, cached: false, failed: true })

    const { data } = await db
      .from('translations')
      .select('text')
      .eq('source_hash', captionHash(text))
      .eq('target_lang', 'fr')
    expect(data ?? []).toHaveLength(0) // next view retries
  })

  test('same source and target language short-circuits', async () => {
    const provider = fakeProvider()
    const result = await translateWithCache(db, provider, trackedText('hi'), 'en', 'en')
    expect(result.failed).toBe(false)
    expect(provider.calls).toBe(0)
  })

  test('providers are swappable behind the same call (adapter seam)', async () => {
    const text = trackedText('adapter swap check')
    const a = fakeProvider('provider-a')
    const b = fakeProvider('provider-b')

    const viaA = await translateWithCache(db, a, text, 'it')
    expect(viaA.text).toContain('provider-a')
    // b hits a's cache — swapping engines never re-buys old translations
    const viaB = await translateWithCache(db, b, text, 'it')
    expect(viaB.cached).toBe(true)
    expect(b.calls).toBe(0)
  })
})

// The modal's on-open translation endpoint (docs/00 D32). memoryId in, never
// arbitrary text — the caption is read with the ANON client, so only live rows
// translate. Real Postgres + anon RLS, fake provider (external boundary).
describe('createTranslateHandler', () => {
  let eventId: string
  beforeAll(async () => {
    eventId = await eventIdByYear(db, 2023)
  })
  const deps = (provider: TranslationProvider | null = fakeProvider('deepl-fake')) => ({
    db,
    anonDb: anon,
    provider,
  })

  async function seed(overrides: Record<string, unknown>): Promise<string> {
    const id = await seedMemory(db, { event_id: eventId, ...overrides } as never)
    memIds.push(id)
    return id
  }

  test('translates a live caption into the viewer locale', async () => {
    const caption = trackedText('the red circle at sunset')
    const id = await seed({ caption, source_lang: 'en' })
    const res = await createTranslateHandler(deps())(post({ memoryId: id, locale: 'ko' }))
    expect(res.status).toBe(200)
    expect((await res.json()).text).toBe(`[deepl-fake:ko] ${caption}`)
  })

  test('same source and target language returns the original (no provider call)', async () => {
    const provider = fakeProvider('deepl-fake')
    const caption = trackedText('same lang')
    const id = await seed({ caption, source_lang: 'ko' })
    const res = await createTranslateHandler(deps(provider))(post({ memoryId: id, locale: 'ko' }))
    expect((await res.json()).text).toBe(caption)
    expect(provider.calls).toBe(0)
  })

  test('no provider configured returns the original, never a blank', async () => {
    const caption = trackedText('no engine')
    const id = await seed({ caption, source_lang: 'en' })
    const res = await createTranslateHandler(deps(null))(post({ memoryId: id, locale: 'ko' }))
    expect((await res.json()).text).toBe(caption)
  })

  test('a hidden moment is invisible to anon — nothing to translate', async () => {
    const caption = trackedText('hidden caption')
    const id = await seed({ caption, source_lang: 'en', status: 'hidden' })
    const res = await createTranslateHandler(deps())(post({ memoryId: id, locale: 'ko' }))
    expect(res.status).toBe(200)
    expect((await res.json()).text).toBeNull()
  })

  test('invalid memoryId or unknown locale is a 400', async () => {
    const bad = await createTranslateHandler(deps())(post({ memoryId: 'not-a-uuid', locale: 'ko' }))
    expect(bad.status).toBe(400)
    const id = await seed({ caption: trackedText('loc'), source_lang: 'en' })
    const badLoc = await createTranslateHandler(deps())(post({ memoryId: id, locale: 'xx' }))
    expect(badLoc.status).toBe(400)
  })
})

describe.skipIf(!process.env.DEEPL_API_KEY)('DeepL live smoke (uses ~30 chars of quota)', () => {
  test('translates EN→KO through the real API', { timeout: 20_000 }, async () => {
    const provider = createDeeplProvider(process.env.DEEPL_API_KEY!)
    const result = await provider.translate('The weekend never happened.', 'ko', 'en')
    expect(result.text.length).toBeGreaterThan(0)
    expect(result.text).not.toBe('The weekend never happened.')
    expect(result.detectedSourceLang).toBe('en')
  })
})

test('captionHash is stable and whitespace-insensitive', () => {
  expect(captionHash('a  b')).toBe(captionHash(' a b '))
  expect(captionHash('a b')).not.toBe(captionHash('a c'))
})
