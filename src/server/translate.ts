import { z } from 'zod'
import { json, parseBody } from '@/lib/server/http'
import { isLocale } from '@/lib/locales'
import { isMomentId } from '@/lib/moments'
import { translateWithCache, type TranslationProvider } from '@/lib/translate'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * On-view caption translation for the wall moment modal (docs/00 D32, docs/16).
 * The moment page translates server-side on render; the modal is client-rendered
 * off the wall's original captions, so it asks here instead of navigating.
 *
 * Input is a memoryId (never arbitrary text) so the endpoint can only translate
 * real, LIVE captions — the caption is read with the anon client (RLS live-only),
 * bounding DeepL usage to (moments × locales), all permanently cached. The
 * service-role client is used ONLY for the translation cache (docs/02).
 */

export interface TranslateDeps {
  db: SupabaseClient // service role — cache writes only
  anonDb: SupabaseClient // anon read — RLS scopes to live rows
  provider: TranslationProvider | null
}

const schema = z.object({
  memoryId: z.string(),
  locale: z.string(),
})

export function createTranslateHandler(deps: TranslateDeps) {
  return async (req: Request): Promise<Response> => {
    const parsed = schema.safeParse(await parseBody(req))
    if (!parsed.success) return json(400, { error: 'invalid request' })
    const { memoryId, locale } = parsed.data
    if (!isMomentId(memoryId) || !isLocale(locale)) return json(400, { error: 'invalid request' })

    // Anon read: a hidden/removed moment finds nothing and never translates.
    const { data } = await deps.anonDb
      .from('memories')
      .select('caption, source_lang')
      .eq('id', memoryId)
      .maybeSingle()

    const caption = data?.caption?.trim()
    if (!caption) return json(200, { text: null })

    // No provider → the original, never a blank (docs/16 D). Same guarantee as
    // the moment page's translateCaption; inlined here because we also persist
    // the detected source language below, which needs the full outcome.
    if (!deps.provider) return json(200, { text: caption })

    const sourceLang = data!.source_lang
    const outcome = await translateWithCache(deps.db, deps.provider, caption, locale, sourceLang)

    // The first real translation is when DeepL reports the true source language;
    // persist it once so a same-language viewer skips the round-trip next time
    // (docs/04). Guarded with .is(null) so it only ever fills an unknown — never
    // overwrites a value the write-time detector set, and safe under a concurrent
    // write. Best-effort: a failure here never blocks returning the translation.
    if (sourceLang == null && outcome.detectedSourceLang && isLocale(outcome.detectedSourceLang)) {
      await deps.db
        .from('memories')
        .update({ source_lang: outcome.detectedSourceLang })
        .eq('id', memoryId)
        .is('source_lang', null)
    }
    return json(200, { text: outcome.text })
  }
}
