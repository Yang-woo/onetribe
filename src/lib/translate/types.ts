export interface TranslationResult {
  text: string
  detectedSourceLang: string | null
}

/**
 * The adapter seam (docs/16 C-2): everything behind translate(), so
 * swapping DeepL for Google/LLM is a provider change, not a refactor.
 */
export interface TranslationProvider {
  readonly name: string
  translate(
    text: string,
    targetLang: string,
    sourceLang?: string | null,
  ): Promise<TranslationResult>
}
