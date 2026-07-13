import type { TranslationProvider, TranslationResult } from './types'

/**
 * DeepL provider — docs/16 C-1. Free keys end in ":fx" and live on the
 * api-free host. Target-language quirks: DeepL deprecated plain EN/PT —
 * we use EN-US and PT-PT (the docs/08 copy is European Portuguese).
 */

const TARGET_LANG_OVERRIDES: Record<string, string> = {
  en: 'EN-US',
  pt: 'PT-PT',
}

export function deeplTargetLang(locale: string): string {
  return TARGET_LANG_OVERRIDES[locale] ?? locale.toUpperCase()
}

export function createDeeplProvider(apiKey: string): TranslationProvider {
  const host = apiKey.endsWith(':fx') ? 'api-free.deepl.com' : 'api.deepl.com'
  return {
    name: 'deepl',
    async translate(text, targetLang, sourceLang): Promise<TranslationResult> {
      const res = await fetch(`https://${host}/v2/translate`, {
        method: 'POST',
        headers: {
          Authorization: `DeepL-Auth-Key ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          text: [text],
          target_lang: deeplTargetLang(targetLang),
          ...(sourceLang ? { source_lang: sourceLang.toUpperCase() } : {}),
        }),
      })
      if (!res.ok) throw new Error(`deepl ${res.status}`)
      const data = (await res.json()) as {
        translations: Array<{ text: string; detected_source_language?: string }>
      }
      const first = data.translations[0]
      if (!first) throw new Error('deepl returned no translations')
      return {
        text: first.text,
        detectedSourceLang: first.detected_source_language?.slice(0, 2).toLowerCase() ?? null,
      }
    },
  }
}
