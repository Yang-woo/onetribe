import { expect, test } from '@playwright/test'

/**
 * The home page's crawl surface, read from the raw response.
 *
 * Its <title> was the bare name until the GSC baseline showed every query that
 * reached this site was a name collision, with not one containing "defqon"
 * (docs/00 D60). A unit test pins the string; only this catches the layout
 * quietly going back to the name — the same blind spot D59's test review found
 * when reverting a description passed everything.
 */
test('the home HTML titles itself by what it is, in every locale', async ({ request }) => {
  const titleOf = async (path: string) => {
    const res = await request.get(path)
    expect(res.ok(), path).toBe(true)
    return (await res.text()).match(/<title[^>]*>([^<]*)</)?.[1]
  }

  const en = await titleOf('/en')
  expect(en, 'the home page rendered no <title>').toBeTruthy()
  expect(en).toContain('Defqon.1')
  // "fan" is the only unaffiliated signal a search result carries: the meta
  // description reuses the hero body, which says nothing about affiliation
  expect(en).toMatch(/\bfan\b/)

  // English in every locale for now, deliberately (docs/00 D23: no second,
  // unreviewed translation layer). Translating it means an i18n key, and this
  // assertion is where that decision has to be made on purpose.
  expect(await titleOf('/ko')).toBe(en)
})

/**
 * The layout's card, seen from a page that does NOT declare its own openGraph.
 * Deleting `openGraph:` from the layout used to pass everything: the home and
 * moment pages declare their own, so the assertions above kept finding a card
 * while about, guidelines, privacy, terms, takedown, upload and passport
 * quietly lost theirs. This is the only page-shaped witness to that line.
 */
test('a page with no card of its own still inherits the site card', async ({ request }) => {
  const html = await (await request.get('/en/about')).text()
  expect(html, 'no og:image — the layout card is gone').toContain('property="og:image"')
  expect(html).toContain('property="og:site_name"')
  expect(html).toMatch(/<meta property="og:type" content="website"/)
  // and the title template, which nothing else pins
  expect(html.match(/<title[^>]*>([^<]*)</)?.[1]).toMatch(/— one tribe$/)
})

test('a filtered wall still shares as the wall', async ({ request }) => {
  const html = await (await request.get('/en?e=2026')).text()
  // a chip click leaves ?e=YYYY in the URL bar (docs/00 D13); without og:url a
  // share of that link scrapes the filtered address as a page of its own
  const ogUrl = html.match(/<meta property="og:url" content="([^"]*)"/)?.[1]
  expect(ogUrl, 'no og:url on the wall').toBeTruthy()
  expect(ogUrl).toMatch(/\/en$/)
  // declaring openGraph on a page replaces the layout's wholesale — the rest
  // of the card has to survive that
  expect(html).toContain('property="og:image"')
  expect(html).toContain('property="og:site_name"')
})
