import { createTranslator } from 'next-intl'
import { describe, expect, test } from 'vitest'
import de from '../../messages/de.json'
import en from '../../messages/en.json'
import es from '../../messages/es.json'
import fr from '../../messages/fr.json'
import it from '../../messages/it.json'
import ja from '../../messages/ja.json'
import ko from '../../messages/ko.json'
import nl from '../../messages/nl.json'
import pt from '../../messages/pt.json'
import pl from '../../messages/pl.json'
import sv from '../../messages/sv.json'
import tr from '../../messages/tr.json'
import zh from '../../messages/zh.json'
import zhHant from '../../messages/zh-Hant.json'
import id from '../../messages/id.json'
import th from '../../messages/th.json'
import vi from '../../messages/vi.json'
import { LOCALES } from '@/lib/locales'

/**
 * Key parity — docs/17 T3.6: every locale ships exactly the EN key set
 * (missing or extra keys are release blockers), and every ICU message
 * uses the same argument names as EN (a renamed argument crashes at
 * render time).
 */

const MESSAGES: Record<string, unknown> = {
  en,
  nl,
  de,
  es,
  fr,
  it,
  pt,
  pl,
  sv,
  tr,
  id,
  th,
  vi,
  zh,
  'zh-Hant': zhHant,
  ja,
  ko,
}

function leafPaths(obj: unknown, prefix = ''): Map<string, string> {
  const paths = new Map<string, string>()
  if (typeof obj === 'string') {
    paths.set(prefix, obj)
    return paths
  }
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key
    for (const [p, v] of leafPaths(value, path)) paths.set(p, v)
  }
  return paths
}

function icuArgs(message: string): string[] {
  return [...message.matchAll(/\{(\w+)[,}]/g)].map((m) => m[1]).sort()
}

const enPaths = leafPaths(en)

test('the messages map covers every configured locale', () => {
  expect(Object.keys(MESSAGES).sort()).toEqual([...LOCALES].sort())
})

describe.each(Object.keys(MESSAGES).filter((l) => l !== 'en'))('%s.json', (locale) => {
  const paths = leafPaths(MESSAGES[locale])

  test('has exactly the EN key set', () => {
    const missing = [...enPaths.keys()].filter((k) => !paths.has(k))
    const extra = [...paths.keys()].filter((k) => !enPaths.has(k))
    expect({ missing, extra }).toEqual({ missing: [], extra: [] })
  })

  test('every ICU message uses the same argument names as EN', () => {
    for (const [path, enMessage] of enPaths) {
      const localized = paths.get(path)
      if (!localized) continue
      expect({ path, args: icuArgs(localized) }).toEqual({ path, args: icuArgs(enMessage) })
    }
  })

  test('no message is left empty', () => {
    for (const [, message] of paths) expect(message.trim().length).toBeGreaterThan(0)
  })
})

/**
 * The header shows `hero.ctaShort` on phones and `hero.cta` from `sm` up, with
 * the full label as the link's accessible name — the header's width budget is
 * really seventeen budgets, and the full label runs 83px to 191px while most
 * locales have ~50px to spare (docs/12).
 *
 * Keeping the short form a substring of the full one is what makes that legal:
 * WCAG 2.5.3 asks that the accessible name contain the visible label, so a
 * speech-input user saying what they can see still hits the button. Nothing in
 * the app can check this at runtime — a translator picking a synonym would
 * break it silently.
 */
describe.each(Object.keys(MESSAGES))('%s.json header CTA', (locale) => {
  test('the short label is contained in the full one', () => {
    const messages = MESSAGES[locale] as { hero: { cta: string; ctaShort: string } }
    const { cta, ctaShort } = messages.hero
    expect({ locale, contains: cta.includes(ctaShort) }).toEqual({ locale, contains: true })
  })
})

/**
 * The argument-name check above compares text with a regex, which cannot see
 * what the ICU *parser* does. A lone apostrophe is ICU's escape character, so
 * translations that legitimately contain one — nl "foto's", tr "MB'tan" — can
 * turn a neighbouring placeholder into literal text. Nothing throws; the number
 * simply never appears and the user reads "{max}MB". Render for real instead.
 */
describe.each(Object.keys(MESSAGES))('%s.json renders', (locale) => {
  test('every parameterised message substitutes its arguments', () => {
    const t = createTranslator({
      locale,
      messages: MESSAGES[locale] as Parameters<typeof createTranslator>[0]['messages'],
      onError: (error) => {
        throw error
      },
    })
    for (const [path, message] of leafPaths(MESSAGES[locale])) {
      const args = icuArgs(message)
      if (args.length === 0 || message.includes('<')) continue // rich text needs t.rich
      const rendered = t(path, Object.fromEntries(args.map((a) => [a, 1])))
      expect({ path, rendered: /[{}]/.test(rendered) }).toEqual({ path, rendered: false })
    }
  })
})
