import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import robots from '@/app/robots'
import { LOCALES } from './locales'
import {
  canonicalHostRedirect,
  localeAlternates,
  momentJsonLd,
  serializeJsonLd,
  sitemapEntries,
  websiteJsonLd,
} from './seo'

// Spec: docs/04 (hreflang = the SEO core) + docs/00 D23 (canonical host,
// sitemap discovery, structured data). Everything here renders into signals
// crawlers act on — a silent regression costs indexing, not pixels.

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://onetribe.world')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('localeAlternates', () => {
  test('every locale plus x-default is present, x-default pointing at /en', () => {
    const { languages } = localeAlternates('/', 'en')
    for (const locale of LOCALES) {
      expect(languages[locale]).toBe(`https://onetribe.world/${locale}`)
    }
    expect(languages['x-default']).toBe('https://onetribe.world/en')
  })

  test('canonical is the self-referencing URL of the requested locale', () => {
    expect(localeAlternates('/', 'ko').canonical).toBe('https://onetribe.world/ko')
    expect(localeAlternates('/upload', 'de').canonical).toBe('https://onetribe.world/de/upload')
  })

  test('the root path gets no trailing slash', () => {
    const { languages } = localeAlternates('/', 'en')
    expect(languages.ja).toBe('https://onetribe.world/ja')
  })
})

describe('canonicalHostRedirect', () => {
  const opts = { base: 'https://onetribe.world', vercelEnv: 'production' }

  test('the vercel.app production alias 308s home, path and query intact', () => {
    const target = canonicalHostRedirect(
      new URL('https://onetribe-dance.vercel.app/ko/upload?e=2026'),
      opts,
    )
    expect(target?.href).toBe('https://onetribe.world/ko/upload?e=2026')
  })

  test('www is not the canonical host either', () => {
    const target = canonicalHostRedirect(new URL('https://www.onetribe.world/en'), opts)
    expect(target?.href).toBe('https://onetribe.world/en')
  })

  test('the canonical host itself passes through', () => {
    expect(canonicalHostRedirect(new URL('https://onetribe.world/en'), opts)).toBeNull()
  })

  test('previews and local dev keep their hosts', () => {
    const preview = new URL('https://onetribe-abc123-yang-woo.vercel.app/en')
    expect(canonicalHostRedirect(preview, { ...opts, vercelEnv: 'preview' })).toBeNull()
    expect(canonicalHostRedirect(preview, { ...opts, vercelEnv: undefined })).toBeNull()
  })

  test('without an explicit site URL nothing redirects (no VERCEL_URL loops)', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '')
    const aliased = new URL('https://onetribe-dance.vercel.app/en')
    expect(canonicalHostRedirect(aliased, { vercelEnv: 'production' })).toBeNull()
  })
})

describe('sitemapEntries', () => {
  const moments = [
    { id: '9f2b7c1e-0000-4000-8000-000000000001', created_at: '2026-06-27T12:00:00Z' },
    { id: '9f2b7c1e-0000-4000-8000-000000000002', created_at: '2026-06-28T09:30:00Z' },
  ]

  test('static pages and moments are all present, admin is not', () => {
    const entries = sitemapEntries(moments)
    const urls = entries.map((e) => e.url)
    expect(urls).toContain('https://onetribe.world/en')
    expect(urls).toContain('https://onetribe.world/en/privacy')
    expect(urls).toContain(`https://onetribe.world/en/m/${moments[0].id}`)
    expect(urls.some((u) => u.includes('/admin'))).toBe(false)
    expect(entries).toHaveLength(8 + moments.length)
  })

  test('every entry carries the full hreflang cluster', () => {
    const entries = sitemapEntries(moments)
    for (const entry of entries) {
      const languages = entry.alternates?.languages as Record<string, string>
      expect(Object.keys(languages)).toHaveLength(LOCALES.length + 1)
      expect(languages['x-default']).toMatch(/^https:\/\/onetribe\.world\/en/)
    }
  })

  test('moments carry lastModified from created_at', () => {
    const entries = sitemapEntries(moments)
    const moment = entries.find((e) => e.url.endsWith(moments[1].id))
    expect(moment?.lastModified).toEqual(new Date(moments[1].created_at))
  })

  test('the home page outranks the rest', () => {
    const entries = sitemapEntries([])
    const home = entries.find((e) => e.url === 'https://onetribe.world/en')
    expect(home?.priority).toBe(1)
    expect(entries.filter((e) => e.priority === 1)).toHaveLength(1)
  })
})

describe('robots', () => {
  test('blocks api and every locale admin, points at the sitemap', () => {
    const result = robots()
    const rule = Array.isArray(result.rules) ? result.rules[0] : result.rules
    expect(rule?.userAgent).toBe('*')
    expect(rule?.disallow).toContain('/api/')
    for (const locale of LOCALES) {
      expect(rule?.disallow).toContain(`/${locale}/admin`)
    }
    expect(result.sitemap).toBe('https://onetribe.world/sitemap.xml')
  })
})

describe('serializeJsonLd', () => {
  test('escapes < so captions cannot close the script element', () => {
    const out = serializeJsonLd({ caption: '</script><script>alert(1)</script>' })
    expect(out).not.toContain('</script>')
    expect(out).toContain('\\u003c/script>')
  })
})

describe('websiteJsonLd', () => {
  test('describes the site with every supported language', () => {
    const data = websiteJsonLd('a memory wall') as Record<string, unknown>
    expect(data['@type']).toBe('WebSite')
    expect(data.url).toBe('https://onetribe.world')
    expect(data.description).toBe('a memory wall')
    expect(data.inLanguage).toEqual([...LOCALES])
  })
})

describe('momentJsonLd', () => {
  const base = {
    id: '9f2b7c1e-0000-4000-8000-000000000001',
    media_kind: 'image' as const,
    media_url: 'https://media.example/m/2026/photo.webp',
    caption: 'sunrise at the endshow',
    author_name: 'warrior',
    author_link: 'https://instagram.com/warrior',
    created_at: '2026-06-27T12:00:00Z',
  }

  test('a photo becomes an ImageObject with author and canonical page', () => {
    const data = momentJsonLd(base, 'ko') as Record<string, unknown>
    expect(data['@type']).toBe('ImageObject')
    expect(data.contentUrl).toBe(base.media_url)
    expect(data.caption).toBe(base.caption)
    expect(data.author).toEqual({
      '@type': 'Person',
      name: 'warrior',
      url: 'https://instagram.com/warrior',
    })
    expect(data.mainEntityOfPage).toBe(`https://onetribe.world/ko/m/${base.id}`)
  })

  test('anonymous moments carry no author node at all', () => {
    const data = momentJsonLd({ ...base, author_name: null, author_link: null }, 'en') as Record<
      string,
      unknown
    >
    expect(data).not.toHaveProperty('author')
  })

  test('clips and media-less rows yield nothing — no image claim we cannot back', () => {
    expect(momentJsonLd({ ...base, media_kind: 'clip' }, 'en')).toBeNull()
    expect(momentJsonLd({ ...base, media_url: null }, 'en')).toBeNull()
  })
})
