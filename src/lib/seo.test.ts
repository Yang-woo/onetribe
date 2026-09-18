import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import robots from '@/app/robots'
import { LOCALES } from './locales'
import {
  aboutPageJsonLd,
  canonicalHostRedirect,
  HOME_TITLE,
  localeAlternates,
  momentDescription,
  momentJsonLd,
  serializeJsonLd,
  siteJsonLd,
  siteOpenGraph,
  sitemapEntries,
  sitemapIndexXml,
} from './seo'
import { SUPPORT_LINKS } from './support'

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

  const languagesOf = (entry: { alternates?: { languages?: unknown } }) =>
    entry.alternates?.languages as Record<string, string>

  test('a locale file lists that locale’s static pages and moments, and never admin', () => {
    const entries = sitemapEntries(moments, 'ko')
    const urls = entries.map((e) => e.url)
    expect(urls).toContain('https://onetribe.world/ko')
    expect(urls).toContain('https://onetribe.world/ko/privacy')
    expect(urls).toContain(`https://onetribe.world/ko/m/${moments[0].id}`)
    expect(urls.every((u) => u.startsWith('https://onetribe.world/ko'))).toBe(true)
    expect(urls.some((u) => u.includes('/admin'))).toBe(false)
    expect(entries).toHaveLength(8 + moments.length)
  })

  test('across the files every language version is an entry of its own (Google: a <url> per URL)', () => {
    const files = LOCALES.map((locale) => sitemapEntries(moments, locale))
    const listed = new Set(files.flat().map((e) => e.url))
    expect(listed.size).toBe(LOCALES.length * (8 + moments.length))
    // the D23 shape listed /ko only as an alternate — no URL may live only there
    const named = files
      .flat()
      .flatMap((e) => Object.entries(languagesOf(e)))
      .filter(([lang]) => lang !== 'x-default')
      .map(([, url]) => url)
    expect(named.filter((url) => !listed.has(url))).toEqual([])
  })

  test('every entry carries the full hreflang cluster, itself included', () => {
    for (const locale of LOCALES) {
      for (const entry of sitemapEntries(moments, locale)) {
        const languages = languagesOf(entry)
        expect(Object.keys(languages)).toHaveLength(LOCALES.length + 1)
        expect(languages[locale]).toBe(entry.url)
        expect(languages['x-default']).toMatch(/^https:\/\/onetribe\.world\/en/)
      }
    }
  })

  test('moments carry lastModified from created_at', () => {
    const entries = sitemapEntries(moments, 'en')
    const moment = entries.find((e) => e.url.endsWith(moments[1].id))
    expect(moment?.lastModified).toEqual(new Date(moments[1].created_at))
  })

  test('the home page outranks the rest in each file', () => {
    const entries = sitemapEntries([], 'ja')
    const home = entries.find((e) => e.url === 'https://onetribe.world/ja')
    expect(home?.priority).toBe(1)
    expect(entries.filter((e) => e.priority === 1)).toHaveLength(1)
  })
})

describe('sitemapIndexXml', () => {
  test('/sitemap.xml indexes one file per locale, on the canonical host', () => {
    const xml = sitemapIndexXml()
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true)
    expect(xml).toContain('<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')
    // each <loc> inside its <sitemap> — bare <loc>s are not a valid index
    const locs = [...xml.matchAll(/<sitemap><loc>([^<]+)<\/loc><\/sitemap>/g)].map((m) => m[1])
    expect(locs).toHaveLength(LOCALES.length)
    expect(locs).toContain('https://onetribe.world/sitemap/ko.xml')
    expect(locs).toContain('https://onetribe.world/sitemap/zh-Hant.xml')
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

describe('siteJsonLd', () => {
  const nodes = () =>
    (siteJsonLd('a memory wall') as { '@graph': Record<string, unknown>[] })['@graph']
  const node = (type: string) => nodes().find((n) => n['@type'] === type)!

  test('one @context for the graph; the website describes every supported language', () => {
    expect((siteJsonLd('a memory wall') as Record<string, unknown>)['@context']).toBe(
      'https://schema.org',
    )
    const site = node('WebSite')
    expect(site.url).toBe('https://onetribe.world')
    expect(site.description).toBe('a memory wall')
    expect(site.inLanguage).toEqual([...LOCALES])
  })

  test('a switched-off donation rail drops out of sameAs rather than leaving a null', () => {
    const kofi = SUPPORT_LINKS.kofi
    SUPPORT_LINKS.kofi = null
    try {
      const sameAs = node('Organization').sameAs as unknown[]
      expect(sameAs).not.toContain(null)
      expect(sameAs).toHaveLength(4)
    } finally {
      SUPPORT_LINKS.kofi = kofi
    }
  })

  test('the website points at the organization by @id — one entity, not a second one', () => {
    const org = node('Organization')
    expect(org['@id']).toBe('https://onetribe.world/#organization')
    expect(node('WebSite').publisher).toEqual({ '@id': org['@id'] })
  })

  test('sameAs claims exactly the profiles the project owns (docs/00 D15, D28)', () => {
    expect(node('Organization').sameAs).toEqual([
      'https://www.instagram.com/onetribe_world/',
      'https://www.threads.com/@onetribe_world',
      'https://www.youtube.com/@onetribeworld',
      'https://github.com/Yang-woo/onetribe',
      'https://ko-fi.com/onetribeworld',
    ])
  })

  test('the logo is a file public/ actually serves; contact is the policy address', () => {
    const org = node('Organization')
    expect(org.logo).toBe('https://onetribe.world/icon-512.png')
    // renaming or dropping the icon must fail here, not ship a dead logo URL
    const { pathname } = new URL(org.logo as string)
    expect(existsSync(join(process.cwd(), 'public', pathname))).toBe(true)
    expect(org.email).toBe('privacy@onetribe.world')
  })
})

describe('momentDescription', () => {
  const bare = { caption: null, author_name: null, author_link: null, origin_country: null }
  const line = 'Biddinghuizen · 2024 · Defqon.1 — Power of the Tribe'

  test('a caption-less moment is described by the facts its page shows, in page order', () => {
    expect(
      momentDescription(
        {
          ...bare,
          author_name: 'raver',
          author_link: 'https://instagram.com/raver_ig',
          origin_country: 'KR',
        },
        line,
        'en',
      ),
    ).toBe(`${line} · raver · @raver_ig · South Korea`)
  })

  test('the caption leads — the uploader, before our metadata', () => {
    expect(momentDescription({ ...bare, caption: 'we are one tribe' }, line, 'en')).toBe(
      `we are one tribe · ${line}`,
    )
  })

  test('the country is named in the reader language, as the page names it', () => {
    expect(momentDescription({ ...bare, origin_country: 'NL' }, null, 'de')).toBe('Niederlande')
  })

  test('nothing to say → no description tag at all, not an empty one', () => {
    expect(momentDescription(bare, null, 'en')).toBeUndefined()
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
    thumb_url: 'https://media.example/m/2026/photo-thumb.webp',
  }

  const line = 'Biddinghuizen · 2026 · Defqon.1 — Sacred Oath'

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

  test('the edition line and city travel as the page prints them', () => {
    const data = momentJsonLd(base, 'en', { line, city: 'Biddinghuizen' }) as Record<
      string,
      unknown
    >
    expect(data.name).toBe(line)
    expect(data.contentLocation).toEqual({ '@type': 'Place', name: 'Biddinghuizen' })
  })

  test('a moment with no edition claims neither a name nor a place', () => {
    const data = momentJsonLd(base, 'en') as Record<string, unknown>
    expect(data).not.toHaveProperty('name')
    expect(data).not.toHaveProperty('contentLocation')
  })

  test('created_at is when the wall received it, not when the photo was taken', () => {
    const data = momentJsonLd(base, 'en') as Record<string, unknown>
    expect(data.uploadDate).toBe(base.created_at)
    // dateCreated would date a 2013 edition's photo to the day it was posted
    expect(data).not.toHaveProperty('dateCreated')
  })

  test('the thumbnail is offered when one exists and never invented', () => {
    expect((momentJsonLd(base, 'en') as Record<string, unknown>).thumbnailUrl).toBe(base.thumb_url)
    expect(momentJsonLd({ ...base, thumb_url: null }, 'en')).not.toHaveProperty('thumbnailUrl')
  })

  test('it points at the same organization and website the home graph declares', () => {
    const data = momentJsonLd(base, 'en') as Record<string, unknown>
    const graph = (siteJsonLd('a memory wall') as { '@graph': Record<string, unknown>[] })['@graph']
    const idOf = (type: string) => graph.find((n) => n['@type'] === type)!['@id']
    expect(data.publisher).toEqual({ '@id': idOf('Organization') })
    expect(data.isPartOf).toEqual({ '@id': idOf('WebSite') })
  })
})

describe('siteOpenGraph', () => {
  test('a page that needs its own og:url still gets the whole card', () => {
    // Next replaces the layout's openGraph wholesale when a page declares one,
    // so a card that lost its image is exactly the regression to catch here
    const og = siteOpenGraph('a memory wall', 'https://onetribe.world/ko')
    expect(og.siteName).toBe('one tribe')
    expect(og.type).toBe('website')
    expect(og.title).toBe('one tribe')
    expect(og.description).toBe('a memory wall')
    expect(og.images).toEqual([
      { url: 'https://onetribe.world/api/og/site', width: 1200, height: 630 },
    ])
    expect(og.url).toBe('https://onetribe.world/ko')
  })

  test('with no url the key is absent rather than empty', () => {
    expect(siteOpenGraph('a memory wall')).not.toHaveProperty('url')
  })
})

describe('aboutPageJsonLd', () => {
  const idOf = (type: string) =>
    (siteJsonLd('a memory wall') as { '@graph': Record<string, unknown>[] })['@graph'].find(
      (n) => n['@type'] === type,
    )!['@id']

  test('it joins the site graph by @id instead of declaring a second organization', () => {
    const data = aboutPageJsonLd('en', 'about') as Record<string, unknown>
    expect(data.mainEntity).toEqual({ '@id': idOf('Organization') })
    expect(data.isPartOf).toEqual({ '@id': idOf('WebSite') })
    expect(JSON.stringify(data)).not.toContain('"Organization"')
  })

  test('each locale’s about page is its own node, named as that page is headed', () => {
    const ko = aboutPageJsonLd('ko', '소개') as Record<string, unknown>
    expect(ko.url).toBe('https://onetribe.world/ko/about')
    expect(ko['@id']).toBe('https://onetribe.world/ko/about#webpage')
    expect(ko.name).toBe('소개')
    expect(ko.inLanguage).toBe('ko')
  })
})

describe('HOME_TITLE', () => {
  test('it names both this project and the festival, inside the snippet limit', () => {
    // GSC showed every query that reached the site was a name collision, and
    // none of them contained "defqon" (docs/00 D60)
    expect(HOME_TITLE).toContain('one tribe')
    expect(HOME_TITLE).toContain('Defqon.1')
    expect(HOME_TITLE.length).toBeLessThanOrEqual(60)
  })

  test('it frames the project as a fan project, never an official one', () => {
    expect(HOME_TITLE).toMatch(/\bfan\b/)
    expect(HOME_TITLE).not.toMatch(/official/i)
  })
})
