import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createDeeplProvider } from './deepl'
import type { TranslationProvider } from './types'

export type { TranslationProvider, TranslationResult } from './types'

/**
 * On-view translation with a permanent (sentence, language) cache —
 * docs/04, docs/16. Operating rules (docs/16 D), all load-bearing:
 *  - cache hit costs nothing, ever (the whole cost model rests on this)
 *  - provider failure returns the ORIGINAL text — never a blank
 *  - the provider name is recorded per row for later A/B swaps
 */

/** Whitespace-insensitive hash so trivially different inputs share a cache row. */
export function captionHash(text: string): string {
  return createHash('sha256').update(text.trim().replace(/\s+/g, ' ')).digest('hex')
}

export interface TranslateOutcome {
  text: string
  cached: boolean
  failed: boolean
  /** DeepL's detected source language, lower-cased — set only on a live
   *  provider call (null on a cache hit, same-language skip, or failure). Lets
   *  the caller back-fill an unknown memories.source_lang (docs/04). */
  detectedSourceLang: string | null
}

export async function translateWithCache(
  db: SupabaseClient, // service role — cache writes are server-only (docs/02)
  provider: TranslationProvider,
  text: string,
  targetLang: string,
  sourceLang?: string | null,
): Promise<TranslateOutcome> {
  const trimmed = text.trim()
  if (!trimmed || (sourceLang && sourceLang === targetLang)) {
    return { text: trimmed, cached: false, failed: false, detectedSourceLang: null }
  }

  const hash = captionHash(trimmed)
  const { data: hit } = await db
    .from('translations')
    .select('text')
    .eq('source_hash', hash)
    .eq('target_lang', targetLang)
    .maybeSingle()
  if (hit) return { text: hit.text, cached: true, failed: false, detectedSourceLang: null }

  try {
    // sourceLang (from the write-time franc guess) drives the same-language SKIP
    // above, but is deliberately NOT forwarded to the provider: franc-min mis-tags
    // short captions, and forcing a wrong source_lang produced a wrong translation
    // that the permanent cache then froze in (docs/04). DeepL's own auto-detection
    // is more reliable and its detected language back-fills an unknown source_lang.
    const result = await provider.translate(trimmed, targetLang)
    const { error: cacheError } = await db.from('translations').upsert({
      source_hash: hash,
      target_lang: targetLang,
      text: result.text,
      provider: provider.name,
    })
    // A cache-write failure must not fail the translation (the text is in hand),
    // but it means we silently re-bought it — so surface it. This is exactly the
    // path that hid every zh-Hant miss before target_lang was widened to text
    // (a char(2) column rejected the 7-char code with 22001 — docs/16).
    if (cacheError) console.error('[translate] cache write failed:', cacheError.message)
    return {
      text: result.text,
      cached: false,
      failed: false,
      detectedSourceLang: result.detectedSourceLang,
    }
  } catch {
    // Original first, blank never (docs/16 D). Not cached: retry on next view.
    return { text: trimmed, cached: false, failed: true, detectedSourceLang: null }
  }
}

/**
 * The on-view caption rule shared by the moment page and the /api/translate
 * route (docs/16): no provider or same language → the original, never blank;
 * otherwise the cached translation. One place so the two callers — and the
 * DeepL cost / never-blank guarantee — can't drift.
 */
export async function translateCaption(
  db: SupabaseClient, // service role — cache writes only
  provider: TranslationProvider | null,
  caption: string | null,
  targetLocale: string,
  sourceLang: string | null,
): Promise<string | null> {
  if (!caption || !provider || sourceLang === targetLocale) return caption
  return (await translateWithCache(db, provider, caption, targetLocale, sourceLang)).text
}

/** Default provider from env — null when unconfigured (dev without keys). */
export function createDefaultProvider(): TranslationProvider | null {
  const key = process.env.DEEPL_API_KEY
  return key ? createDeeplProvider(key) : null
}
