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

const MESSAGES: Record<string, unknown> = { en, nl, de, es, fr, it, pt, pl, sv, tr, id, th, vi, zh, 'zh-Hant': zhHant, ja, ko }

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
