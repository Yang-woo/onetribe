'use client'

import { useTranslations } from 'next-intl'
import { useState } from 'react'

/**
 * Translated caption with an "show original" escape hatch (docs/15 §3).
 * Translation quirks should never hide what the uploader actually wrote.
 */
export function CaptionToggle({ original, translated }: { original: string; translated: string }) {
  const t = useTranslations('moment')
  const [showOriginal, setShowOriginal] = useState(false)

  if (translated === original) return <p className="text-lg">{original}</p>

  return (
    <div className="flex flex-col gap-1">
      <p className="text-lg">{showOriginal ? original : translated}</p>
      <button
        type="button"
        onClick={() => setShowOriginal((v) => !v)}
        className="self-start text-sm text-flame hover:underline"
      >
        {showOriginal ? t('showTranslation') : t('showOriginal')}
      </button>
    </div>
  )
}
