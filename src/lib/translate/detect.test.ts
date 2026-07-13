import { describe, expect, test } from 'vitest'
import { detectCaptionLocale } from './detect'

// Best-effort write-time detection (docs/04): confident guesses only,
// null otherwise — DeepL corrects on first translation.

describe('detectCaptionLocale', () => {
  test('detects the core caption languages', () => {
    expect(
      detectCaptionLocale('the sunrise over the red stage was absolutely unreal this year'),
    ).toBe('en')
    expect(detectCaptionLocale('올해 레드 스테이지의 일출은 정말 잊을 수 없는 순간이었다')).toBe(
      'ko',
    )
    expect(detectCaptionLocale('今年のレッドステージの日の出は本当に忘れられない瞬間だった')).toBe(
      'ja',
    )
    expect(
      detectCaptionLocale('dit jaar was de zonsopgang boven het podium echt onvergetelijk mooi'),
    ).toBe('nl')
  })

  test('short or empty captions stay null', () => {
    expect(detectCaptionLocale('HARDER!')).toBeNull()
    expect(detectCaptionLocale('')).toBeNull()
    expect(detectCaptionLocale(null)).toBeNull()
    expect(detectCaptionLocale(undefined)).toBeNull()
  })
})
