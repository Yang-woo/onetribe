import { afterEach, describe, expect, test, vi } from 'vitest'
import { newMomentMessage, notifyDiscord, reportMessage } from './discord'

/**
 * Operator Discord alerts (docs/00 D36). The load-bearing guarantee: the
 * notifier is best-effort — it no-ops without config and NEVER throws, so it
 * can't fail an upload or report. The builders shape each alert.
 */

describe('notifyDiscord', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.DISCORD_WEBHOOK_URL
  })

  test('no-op when the webhook URL is unset — never touches the network', async () => {
    delete process.env.DISCORD_WEBHOOK_URL
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    await notifyDiscord({ content: 'hi' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  test('POSTs the message as JSON when configured', async () => {
    process.env.DISCORD_WEBHOOK_URL = 'https://discord.test/webhook'
    const fetchSpy = vi.fn(
      async (_url: string, _init: RequestInit) => new Response(null, { status: 204 }),
    )
    vi.stubGlobal('fetch', fetchSpy)
    await notifyDiscord({ content: 'hello' })
    expect(fetchSpy).toHaveBeenCalledOnce()
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe('https://discord.test/webhook')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ content: 'hello' })
  })

  test('never throws when the webhook fails — the user action must not fail', async () => {
    process.env.DISCORD_WEBHOOK_URL = 'https://discord.test/webhook'
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down')
      }),
    )
    await expect(notifyDiscord({ content: 'x' })).resolves.toBeUndefined()
  })
})

describe('newMomentMessage', () => {
  test('single moment: caption, image, author, country flag, and /m/ permalink', () => {
    const msg = newMomentMessage([
      {
        id: 'abc',
        caption: 'sunrise over red',
        authorName: 'yann',
        country: 'KR',
        imageUrl: 'https://media.test/x.jpg',
        kind: 'image',
      },
    ])
    expect(msg.content).toBe('🧡 new moment on the wall')
    expect(msg.embeds).toHaveLength(1)
    const e = msg.embeds![0]
    expect(e.title).toBe('sunrise over red')
    expect(e.url).toMatch(/\/m\/abc$/)
    expect(e.image).toEqual({ url: 'https://media.test/x.jpg' })
    expect(e.fields!.find((f) => f.name === 'by')!.value).toBe('yann')
    const from = e.fields!.find((f) => f.name === 'from')!
    expect(from.value).toContain('KR')
    expect(from.value).toContain('🇰🇷') // countryFlag(KR)
  })

  test('anonymous + no country + no caption + clip: fallbacks, no image, no country field', () => {
    const msg = newMomentMessage([
      { id: 'z', caption: null, authorName: null, country: null, imageUrl: null, kind: 'clip' },
    ])
    const e = msg.embeds![0]
    expect(e.title).toBe('(no caption)')
    expect(e.image).toBeUndefined() // a clip carries no media image
    expect(e.fields!.find((f) => f.name === 'by')!.value).toBe('anonymous')
    expect(e.fields!.some((f) => f.name === 'from')).toBe(false)
  })

  test('batch: one embed per moment and a counted header', () => {
    const msg = newMomentMessage([
      { id: 'a', caption: 'one', authorName: 'x', country: null, imageUrl: 'u/a', kind: 'image' },
      { id: 'b', caption: 'two', authorName: 'x', country: null, imageUrl: 'u/b', kind: 'image' },
    ])
    expect(msg.content).toBe('🧡 2 new moments on the wall')
    expect(msg.embeds!.map((e) => e.url!.slice(-4))).toEqual(['/m/a'.slice(-4), '/m/b'.slice(-4)])
  })

  test('a long caption is truncated for the embed title', () => {
    const msg = newMomentMessage([
      {
        id: 'a',
        caption: 'x'.repeat(300),
        authorName: null,
        country: null,
        imageUrl: null,
        kind: 'image',
      },
    ])
    expect(msg.embeds![0].title!.length).toBeLessThanOrEqual(200)
    expect(msg.embeds![0].title!.endsWith('…')).toBe(true)
  })
})

describe('reportMessage', () => {
  test('links to the moment and the admin console with the reason', () => {
    const e = reportMessage('mid-1', 'nsfw').embeds![0]
    expect(e.title).toContain('nsfw')
    expect(e.url).toMatch(/\/m\/mid-1$/)
    expect(e.description).toContain('/m/mid-1')
    expect(e.description).toContain('/admin')
  })
})
