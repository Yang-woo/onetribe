import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { llmsTxt, type WallFigures } from './llms-txt'
import { LOCALES } from './locales'

// Spec: GEO — /llms.txt is what an assistant reads before it decides whether
// this site is worth citing. Two things must hold no matter what: it never
// claims to originate data it merely displays, and it never prints a count it
// could not actually read.

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://onetribe.world')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

const figures: WallFigures = {
  moments: 243,
  countries: 10,
  editions: [
    { year: 2026, edition: 'Sacred Oath', canceled: true },
    { year: 2025, edition: 'Where Legends Rise', canceled: false },
    { year: 2021, edition: null, canceled: true },
  ],
  asOf: new Date('2026-09-18T06:30:00Z'),
}

describe('llmsTxt', () => {
  test('the unaffiliated notice travels with the description, always', () => {
    for (const out of [llmsTxt(figures), llmsTxt(null)]) {
      expect(out).toContain('Not affiliated')
      expect(out).toContain('Q-dance')
    }
  })

  test('the wall figures are served with the timestamp that makes them quotable', () => {
    const out = llmsTxt(figures)
    expect(out).toContain('- As of: 2026-09-18T06:30:00.000Z')
    expect(out).toContain('- Moments on the wall: 243')
    expect(out).toContain('- Countries the uploaders named: 10')
    expect(out).toContain(`- Languages served: ${LOCALES.length}`)
  })

  test('a failed read drops the numbers instead of printing zeros with a fresh date', () => {
    const out = llmsTxt(null)
    expect(out).not.toMatch(/Moments on the wall/)
    expect(out).not.toMatch(/- As of:/)
    expect(out).toContain('could not be')
    // a zero count would read as "this wall is empty", which is a different claim
    expect(out).not.toMatch(/: 0\b/)
  })

  test('editions are listed as the wall names them, cancellation included', () => {
    const out = llmsTxt(figures)
    expect(out).toContain('| 2026 | Sacred Oath | canceled |')
    expect(out).toContain('| 2025 | Where Legends Rise | held |')
    // a canceled year with no anthem still gets a row, not a blank cell
    expect(out).toContain('| 2021 | — | canceled |')
  })

  test('anthem titles are disclaimed as other people’s data wherever they appear', () => {
    const out = llmsTxt(figures)
    expect(out).toContain('Sacred Oath')
    expect(out).toMatch(/Anthem titles are not this site’s data/)
    expect(out).toContain('Cite them to their')
  })

  test('with no editions to show, the table and its sourcing note both stay away', () => {
    const out = llmsTxt({ ...figures, editions: [] })
    expect(out).not.toContain('| Year | Edition (anthem) | Status |')
    expect(out).not.toMatch(/Anthem titles are not/)
  })

  test('the figures are claimed as ours — that claim is the point of the file', () => {
    expect(llmsTxt(figures)).toContain('exist nowhere else')
    expect(llmsTxt(figures)).toContain('The wall figures above are ours')
  })

  test('both places that state a language count say the same number', () => {
    // two independent outputs, one of which used to be a literal "17" — they
    // drift apart the day someone edits one and not the other
    const out = llmsTxt(figures)
    const across = Number(out.match(/across (\d+) languages/)?.[1])
    const served = Number(out.match(/Languages served: (\d+)/)?.[1])
    expect(across).toBe(LOCALES.length)
    expect(served).toBe(LOCALES.length)
  })

  test('links point at the canonical host and the contact address is reachable', () => {
    const out = llmsTxt(figures)
    expect(out).toContain('https://onetribe.world/en/about')
    expect(out).toContain('- privacy@onetribe.world')
    expect(out).not.toContain('undefined')
  })

  /**
   * The route is public and unauthenticated, and the figures it prints are the
   * only place this file touches the database. Today the wall_counters view
   * pins itself to live rows, so even a wrong client would read the same
   * number — but the day someone reaches for `memories` here, a service-role
   * client would put hidden moments into public plain text. Pin the client.
   */
  test('the route reads as anon, through the same cached helpers as the wall', () => {
    const route = readFileSync(join(process.cwd(), 'src/app/llms.txt/route.ts'), 'utf8')
    // Code only: the comment above that route explains why a service-role read
    // would be a leak, and a bare word match flags its own warning.
    const code = route.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
    expect(code).toContain('moments-cache')
    expect(code).not.toContain('createServiceRoleClient')
    expect(code).not.toContain('SUPABASE_SERVICE_ROLE_KEY')
    expect(code).not.toMatch(/from\(['"]memories['"]\)/)
  })
})
