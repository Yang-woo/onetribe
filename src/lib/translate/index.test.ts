import { describe, expect, test } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { translateWithCache } from './index'
import type { TranslationProvider } from './types'

/**
 * The on-view cache orchestration (docs/04, docs/16). The load-bearing rule
 * guarded here: the write-time source_lang (a franc-min GUESS) drives the
 * same-language skip but is NEVER forwarded to the provider — franc mis-tags
 * short captions, and a forced-wrong source_lang used to bake a wrong
 * translation into the permanent cache.
 */

/** A cache-miss db: the translations lookup finds nothing, upserts succeed. */
function missDb(): SupabaseClient {
  return {
    from() {
      return {
        select: () => ({
          eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }),
        }),
        upsert: async () => ({ error: null }),
      }
    },
  } as unknown as SupabaseClient
}

function spyProvider() {
  const calls: Array<{ text: string; target: string; source: string | null | undefined }> = []
  const provider: TranslationProvider = {
    name: 'spy',
    async translate(text, targetLang, sourceLang) {
      calls.push({ text, target: targetLang, source: sourceLang })
      return { text: `T:${text}`, detectedSourceLang: 'en' }
    },
  }
  return { provider, calls }
}

describe('translateWithCache', () => {
  test('does NOT forward the write-time source_lang to the provider (franc mis-tag must not poison the cache)', async () => {
    const { provider, calls } = spyProvider()
    // 'nl' here stands in for a wrong franc guess on an actually-English caption.
    const outcome = await translateWithCache(missDb(), provider, 'sunrise over red', 'de', 'nl')

    expect(calls).toHaveLength(1)
    expect(calls[0].source).toBeUndefined() // provider auto-detects, not forced to 'nl'
    expect(outcome.text).toBe('T:sunrise over red')
    expect(outcome.detectedSourceLang).toBe('en') // DeepL's detection can back-fill source_lang
  })

  test('still skips the round-trip when the stored source_lang equals the target', async () => {
    const { provider, calls } = spyProvider()
    const outcome = await translateWithCache(missDb(), provider, 'hallo daar', 'nl', 'nl')

    expect(calls).toHaveLength(0) // same language → original, never a provider call
    expect(outcome.text).toBe('hallo daar')
    expect(outcome.failed).toBe(false)
  })
})
