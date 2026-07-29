import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { hashIp } from '@/lib/server/request-meta'
import { THUMB_MAX_UPLOAD_BYTES, UPLOADS_PER_HOUR } from '@/lib/upload/constants'
import type { StorageAdapter } from '@/lib/storage'
import {
  createMemoriesHandler,
  createPresignHandler,
  createReportHandler,
  type PublishDeps,
  type ReportDeps,
} from '@/server/upload'
import { createAnonClient, createServiceClient, eventIdByYear, seedMemory } from './helpers'

/**
 * Upload pipeline — docs/17 T2.1. External boundaries (storage, Turnstile)
 * are faked; the database is the real local Supabase (docs/00 D8). These
 * routes are the only write path (D9 P1), so this suite is the security
 * boundary's spec.
 */

const db = createServiceClient()
const anon = createAnonClient()

// Random per-run IPs keep DB-backed rate-limit state from leaking across runs.
const runId = Math.floor(Math.random() * 250)
const IP = `10.20.${runId}.1`
const RATE_IP = `10.20.${runId}.2`
const REPORT_IP_BASE = `10.21.${runId}`

const MARKER = `upload-api-${randomUUID().slice(0, 8)}`

// Anon users minted by the passport-attribution tests — torn down in afterAll
// so a failing assertion mid-test can't leak an auth user + profile row.
const createdUserIds: string[] = []

const fakeStorage: StorageAdapter = {
  async presignUpload({ key, contentType, contentLength }) {
    return {
      key,
      uploadUrl: `https://fake-storage.test/put/${key}`,
      headers: { 'content-type': contentType, 'content-length': String(contentLength) },
    }
  },
  publicUrl: (key) => `https://media.test/${key}`,
  keyForUrl: (url) => (url.startsWith('https://media.test/') ? url.slice(19) : null),
  deleteObject: async () => {},
}

const allow = async () => true
const deny = async () => false

// Cache tags dropped by the handler under test — asserted by the counter tests
// below. Reset per test so one publish can't satisfy another's assertion.
let revalidated: string[] = []

function deps(overrides: Partial<PublishDeps> = {}): PublishDeps {
  return {
    storage: fakeStorage,
    verifyTurnstile: allow,
    db,
    sessionSecret: 'test-secret',
    revalidate: (tag) => revalidated.push(tag),
    ...overrides,
  }
}

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/test', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': IP, ...headers },
    body: JSON.stringify(body),
  })
}

let eventId: string

async function presignFiles(
  files: Array<{
    contentType: string
    size: number
    thumb?: { contentType: string; size: number }
  }>,
): Promise<{ uploads: Array<{ key: string; thumb?: { key: string } }>; session: string }> {
  const res = await createPresignHandler(deps())(post({ turnstileToken: 't', files }))
  expect(res.status).toBe(200)
  return res.json()
}

async function countMarkerRows(): Promise<number> {
  const { count } = await db
    .from('memories')
    .select('*', { count: 'exact', head: true })
    .eq('caption', MARKER)
  return count ?? 0
}

beforeAll(async () => {
  eventId = await eventIdByYear(db, 2023)
})

// presign now records a rate event, so the shared default IP accumulates
// across tests — clear it after each so tests stay order-independent. Tests
// that assert rate limiting use their own dedicated IPs.
afterEach(async () => {
  revalidated = []
  await db.from('upload_events').delete().eq('ip_hash', hashIp(IP, 'upload'))
})

afterAll(async () => {
  await db.from('memories').delete().like('caption', `%${MARKER}%`)
  for (const uid of createdUserIds) await db.auth.admin.deleteUser(uid)
  await db
    .from('upload_events')
    .delete()
    .in('ip_hash', [
      hashIp(IP, 'upload'),
      hashIp(RATE_IP, 'upload'),
      ...Array.from({ length: 5 }, (_, i) => hashIp(`${REPORT_IP_BASE}.${i}`, 'report')),
    ])
})

describe('POST /api/upload/presign', () => {
  test('Turnstile failure → 403', async () => {
    const res = await createPresignHandler(deps({ verifyTurnstile: deny }))(
      post({ turnstileToken: 'bad', files: [{ contentType: 'image/jpeg', size: 1000 }] }),
    )
    expect(res.status).toBe(403)
  })

  test('disallowed MIME → 400', async () => {
    const res = await createPresignHandler(deps())(
      post({ turnstileToken: 't', files: [{ contentType: 'video/mp4', size: 1000 }] }),
    )
    expect(res.status).toBe(400)
  })

  test('oversized file → 400', async () => {
    const res = await createPresignHandler(deps())(
      post({ turnstileToken: 't', files: [{ contentType: 'image/jpeg', size: 11 * 1024 * 1024 }] }),
    )
    expect(res.status).toBe(400)
  })

  test('more than 5 files → 400', async () => {
    const files = Array.from({ length: 6 }, () => ({ contentType: 'image/jpeg', size: 1000 }))
    const res = await createPresignHandler(deps())(post({ turnstileToken: 't', files }))
    expect(res.status).toBe(400)
  })

  test('success returns per-file signed uploads + a session grant', async () => {
    const { uploads, session } = await presignFiles([
      { contentType: 'image/jpeg', size: 1000 },
      { contentType: 'image/gif', size: 2000 },
    ])
    expect(uploads).toHaveLength(2)
    expect(uploads[0].key).toMatch(/\.jpg$/)
    expect(uploads[1].key).toMatch(/\.gif$/)
    expect(new Set(uploads.map((u) => u.key)).size).toBe(2)
    expect(session.length).toBeGreaterThan(20)
  })

  test('a file with a thumbnail gets a paired thumb upload sharing the uuid (D21)', async () => {
    const { uploads } = await presignFiles([
      { contentType: 'image/jpeg', size: 1000, thumb: { contentType: 'image/webp', size: 200 } },
    ])
    expect(uploads).toHaveLength(1)
    expect(uploads[0].key).toMatch(/\.jpg$/)
    // thumb key is the main key with the _t.webp suffix (same upload uuid)
    expect(uploads[0].thumb!.key).toBe(uploads[0].key.replace(/\.jpg$/, '_t.webp'))
  })

  test('a non-WebP thumbnail descriptor → 400 (D21 — thumbs are pinned to WebP)', async () => {
    const res = await createPresignHandler(deps())(
      post({
        turnstileToken: 't',
        files: [
          { contentType: 'image/jpeg', size: 1000, thumb: { contentType: 'image/png', size: 500 } },
        ],
      }),
    )
    expect(res.status).toBe(400)
  })

  test('a thumbnail over the thumb size ceiling → 400 (D21)', async () => {
    const res = await createPresignHandler(deps())(
      post({
        turnstileToken: 't',
        files: [
          {
            contentType: 'image/jpeg',
            size: 1000,
            thumb: { contentType: 'image/webp', size: THUMB_MAX_UPLOAD_BYTES + 1 },
          },
        ],
      }),
    )
    expect(res.status).toBe(400)
  })
})

describe('POST /api/memories — file flow', () => {
  test('rightsConfirmed=false → 400 and nothing is inserted (legal gate)', async () => {
    const { uploads, session } = await presignFiles([{ contentType: 'image/jpeg', size: 1000 }])
    const before = await countMarkerRows()
    const res = await createMemoriesHandler(deps())(
      post({
        session,
        eventId,
        caption: MARKER,
        rightsConfirmed: false,
        media: uploads.map((u) => ({ key: u.key, contentType: 'image/jpeg' })),
      }),
    )
    expect(res.status).toBe(400)
    expect(await countMarkerRows()).toBe(before)
  })

  // The wall inserts new moments over realtime, but "N moments · M countries"
  // is server-rendered from a 60s cache (docs/00 D12). Without this drop the
  // uploader watches their own photo land while the count still reads the old
  // number — and a rejected upload must not drop it, or every bot probe
  // re-queries the counters.
  test('a published moment drops the cached counters; a rejected one does not', async () => {
    const { uploads, session } = await presignFiles([{ contentType: 'image/jpeg', size: 1000 }])
    const media = uploads.map((u) => ({ key: u.key, contentType: 'image/jpeg' }))

    const rejected = await createMemoriesHandler(deps())(
      post({ session, eventId, caption: MARKER, rightsConfirmed: false, media }),
    )
    expect(rejected.status).toBe(400)
    expect(revalidated).toEqual([])

    const published = await createMemoriesHandler(deps())(
      post({ session, eventId, caption: MARKER, rightsConfirmed: true, media }),
    )
    expect(published.status).toBe(201)
    expect(revalidated).toContain('counters')
  })

  test('a revalidate that throws never fails a saved moment', async () => {
    const { uploads, session } = await presignFiles([{ contentType: 'image/jpeg', size: 1000 }])
    const before = await countMarkerRows()
    const res = await createMemoriesHandler(
      deps({
        revalidate: () => {
          throw new Error('no request scope')
        },
      }),
    )(
      post({
        session,
        eventId,
        caption: MARKER,
        rightsConfirmed: true,
        media: uploads.map((u) => ({ key: u.key, contentType: 'image/jpeg' })),
      }),
    )
    expect(res.status).toBe(201)
    expect(await countMarkerRows()).toBe(before + 1)
  })

  test('a replayed session cannot mint duplicate rows (media_url UNIQUE)', async () => {
    const { uploads, session } = await presignFiles([{ contentType: 'image/jpeg', size: 1000 }])
    const body = {
      session,
      eventId,
      rightsConfirmed: true,
      caption: MARKER,
      media: uploads.map((u) => ({ key: u.key, contentType: 'image/jpeg' })),
    }
    const first = await createMemoriesHandler(deps())(post(body))
    expect(first.status).toBe(201)
    // Replaying the SAME session + server key re-derives the same media_url; the
    // partial UNIQUE index rejects it, so one valid session can't be looped into
    // unlimited duplicate live rows (D9 P4 "1 solve = 1 batch", migration 000200).
    const replay = await createMemoriesHandler(deps())(post(body))
    expect(replay.status).not.toBe(201)
    const { count } = await db
      .from('memories')
      .select('*', { count: 'exact', head: true })
      .eq('media_url', `https://media.test/${uploads[0].key}`)
    expect(count).toBe(1)
  })

  test('missing or forged session → 403', async () => {
    const { uploads } = await presignFiles([{ contentType: 'image/jpeg', size: 1000 }])
    const media = uploads.map((u) => ({ key: u.key, contentType: 'image/jpeg' }))

    const missing = await createMemoriesHandler(deps())(
      post({ eventId, rightsConfirmed: true, media }),
    )
    expect(missing.status).toBe(403)

    const { session: forged } = await presignFiles([{ contentType: 'image/jpeg', size: 1 }])
    const wrongSecret = await createMemoriesHandler(deps({ sessionSecret: 'other-secret' }))(
      post({ session: forged, eventId, rightsConfirmed: true, media }),
    )
    expect(wrongSecret.status).toBe(403)
  })

  test('keys outside the session grant → 403', async () => {
    const { session } = await presignFiles([{ contentType: 'image/jpeg', size: 1000 }])
    const res = await createMemoriesHandler(deps())(
      post({
        session,
        eventId,
        rightsConfirmed: true,
        media: [{ key: 'm/2026/not-my-key.jpg', contentType: 'image/jpeg' }],
      }),
    )
    expect(res.status).toBe(403)
  })

  test('unknown event → 400', async () => {
    const { uploads, session } = await presignFiles([{ contentType: 'image/jpeg', size: 1000 }])
    const res = await createMemoriesHandler(deps())(
      post({
        session,
        eventId: randomUUID(),
        rightsConfirmed: true,
        media: uploads.map((u) => ({ key: u.key, contentType: 'image/jpeg' })),
      }),
    )
    expect(res.status).toBe(400)
  })

  test('caption over 500 chars → 400', async () => {
    const { uploads, session } = await presignFiles([{ contentType: 'image/jpeg', size: 1000 }])
    const res = await createMemoriesHandler(deps())(
      post({
        session,
        eventId,
        caption: 'x'.repeat(501),
        rightsConfirmed: true,
        media: uploads.map((u) => ({ key: u.key, contentType: 'image/jpeg' })),
      }),
    )
    expect(res.status).toBe(400)
  })

  test('happy path: batch of 2 → 2 live rows, derived URLs, picked country stored, IG link normalized', async () => {
    const { uploads, session } = await presignFiles([
      { contentType: 'image/jpeg', size: 1000 },
      { contentType: 'image/gif', size: 2000 },
    ])
    const res = await createMemoriesHandler(deps())(
      post(
        {
          session,
          eventId,
          caption: `${MARKER}-happy`,
          authorName: 'tester',
          authorLink: '@onetribe.world',
          country: 'nl',
          rightsConfirmed: true,
          media: [
            { key: uploads[0].key, contentType: 'image/jpeg' },
            { key: uploads[1].key, contentType: 'image/gif' },
          ],
        },
        // the geo header is present but must be IGNORED at post — origin_country
        // comes from the picker's value, never an IP fallback (docs/00 D31)
        { 'x-vercel-ip-country': 'KR' },
      ),
    )
    expect(res.status).toBe(201)
    const { moments } = await res.json()
    expect(moments).toHaveLength(2)
    for (const moment of moments) {
      expect(moment.id).toMatch(/^[0-9a-f-]{36}$/)
      expect(moment.takedownToken).toMatch(/^[0-9a-f-]{36}$/)
    }

    const { data: rows } = await db
      .from('memories')
      .select('media_kind, media_url, thumb_url, status, origin_country, author_link, author_name')
      .eq('caption', `${MARKER}-happy`)
    expect(rows).toHaveLength(2)
    // enum columns sort by definition order, so compare as a set
    expect(rows!.map((r) => r.media_kind).sort()).toEqual(['gif', 'image'])
    for (const row of rows!) {
      expect(row.status).toBe('live')
      expect(row.media_url).toMatch(/^https:\/\/media\.test\/m\/\d{4}\//)
      expect(row.thumb_url).toBeNull() // no thumbKey sent → wall falls back to media_url
      expect(row.origin_country).toBe('NL') // the picked country (normalized), not the 'KR' geo header
      expect(row.author_link).toBe('https://instagram.com/onetribe.world')
      expect(row.author_name).toBe('tester')
    }
  })

  test('a successful upload fires a best-effort Discord alert with the image + permalink (D36)', async () => {
    const notify = vi.fn(async (_msg: unknown) => {})
    const { uploads, session } = await presignFiles([{ contentType: 'image/jpeg', size: 1000 }])
    const res = await createMemoriesHandler(deps({ notify }))(
      post({
        session,
        eventId,
        caption: `${MARKER}-discord`,
        rightsConfirmed: true,
        media: [{ key: uploads[0].key, contentType: 'image/jpeg' }],
      }),
    )
    expect(res.status).toBe(201)
    expect(notify).toHaveBeenCalledTimes(1)
    const msg = notify.mock.calls[0][0] as {
      embeds: Array<{ url: string; image?: { url: string } }>
    }
    expect(msg.embeds[0].url).toMatch(/\/m\/[0-9a-f-]{36}$/)
    expect(msg.embeds[0].image?.url).toBe(`https://media.test/${uploads[0].key}`)
  })

  test('a throwing notifier never fails a saved upload — the alert is best-effort (D36)', async () => {
    const notify = vi.fn(async () => {
      throw new Error('discord down')
    })
    const { uploads, session } = await presignFiles([{ contentType: 'image/jpeg', size: 1000 }])
    const res = await createMemoriesHandler(deps({ notify }))(
      post({
        session,
        eventId,
        caption: `${MARKER}-notify-throws`,
        rightsConfirmed: true,
        media: [{ key: uploads[0].key, contentType: 'image/jpeg' }],
      }),
    )
    // the moment was saved, so the failing alert must NOT turn it into a 500
    expect(res.status).toBe(201)
    expect(notify).toHaveBeenCalledTimes(1)
    const { count } = await db
      .from('memories')
      .select('*', { count: 'exact', head: true })
      .eq('caption', `${MARKER}-notify-throws`)
    expect(count).toBe(1)
  })

  test('media aspect_ratio round-trips; an out-of-range value is nulled (D32)', async () => {
    const { uploads, session } = await presignFiles([
      { contentType: 'image/jpeg', size: 1000 },
      { contentType: 'image/gif', size: 2000 },
    ])
    const res = await createMemoriesHandler(deps())(
      post({
        session,
        eventId,
        caption: `${MARKER}-aspect`,
        rightsConfirmed: true,
        media: [
          { key: uploads[0].key, contentType: 'image/jpeg', aspectRatio: 1.5 }, // valid
          { key: uploads[1].key, contentType: 'image/gif', aspectRatio: 99 }, // out of range
        ],
      }),
    )
    expect(res.status).toBe(201)

    // anon reads it (it's in PUBLIC_MEMORY_COLUMNS) — the wall's real path
    const { data: rows } = await anon
      .from('memories')
      .select('media_kind, aspect_ratio')
      .eq('caption', `${MARKER}-aspect`)
    const byKind = Object.fromEntries(rows!.map((r) => [r.media_kind, r.aspect_ratio]))
    expect(byKind.image).toBe(1.5)
    expect(byKind.gif).toBeNull() // 99 is out of the sane band → placeholder fallback
  })

  test('the picked country is validated: an unassigned code is dropped, not stored (D31)', async () => {
    const { uploads, session } = await presignFiles([{ contentType: 'image/jpeg', size: 1000 }])
    const res = await createMemoriesHandler(deps())(
      post({
        session,
        eventId,
        caption: `${MARKER}-badcountry`,
        country: 'zz', // well-formed but not an assigned ISO code → nulled, not 400'd
        rightsConfirmed: true,
        media: [{ key: uploads[0].key, contentType: 'image/jpeg' }],
      }),
    )
    expect(res.status).toBe(201)
    const { data: row } = await db
      .from('memories')
      .select('origin_country')
      .eq('caption', `${MARKER}-badcountry`)
      .single()
    expect(row!.origin_country).toBeNull()
  })

  test('an empty picker publishes no country — the geo header is never a fallback (opt-out, D31)', async () => {
    const { uploads, session } = await presignFiles([{ contentType: 'image/jpeg', size: 1000 }])
    const res = await createMemoriesHandler(deps())(
      post(
        {
          session,
          eventId,
          caption: `${MARKER}-nocountry`,
          rightsConfirmed: true,
          media: [{ key: uploads[0].key, contentType: 'image/jpeg' }],
        },
        // geo header present, but the user picked nothing → origin_country stays
        // null; we never backfill an undisclosed IP-inferred location (D31)
        { 'x-vercel-ip-country': 'KR' },
      ),
    )
    expect(res.status).toBe(201)
    const { data: row } = await db
      .from('memories')
      .select('origin_country')
      .eq('caption', `${MARKER}-nocountry`)
      .single()
    expect(row!.origin_country).toBeNull()
  })

  test('a media item with a thumbKey stores a derived thumb_url (D21)', async () => {
    const { uploads, session } = await presignFiles([
      { contentType: 'image/jpeg', size: 1000, thumb: { contentType: 'image/webp', size: 200 } },
    ])
    const res = await createMemoriesHandler(deps())(
      post({
        session,
        eventId,
        caption: `${MARKER}-thumb`,
        rightsConfirmed: true,
        media: [
          { key: uploads[0].key, thumbKey: uploads[0].thumb!.key, contentType: 'image/jpeg' },
        ],
      }),
    )
    expect(res.status).toBe(201)
    const { data: row } = await db
      .from('memories')
      .select('media_url, thumb_url')
      .eq('caption', `${MARKER}-thumb`)
      .single()
    // both URLs are derived from server-held keys, never client-supplied
    expect(row!.media_url).toBe(`https://media.test/${uploads[0].key}`)
    expect(row!.thumb_url).toBe(`https://media.test/${uploads[0].thumb!.key}`)
  })

  test('mixed batch: only the file carrying a thumbKey gets a thumb_url (D21)', async () => {
    // File 0 has a thumbnail, file 1 does not — the wall must fall back for 1
    // while 0 gets its thumb. Guards the per-row key→thumb mapping (index drift).
    const { uploads, session } = await presignFiles([
      { contentType: 'image/jpeg', size: 1000, thumb: { contentType: 'image/webp', size: 200 } },
      { contentType: 'image/jpeg', size: 1500 },
    ])
    expect(uploads[1].thumb).toBeUndefined()
    const res = await createMemoriesHandler(deps())(
      post({
        session,
        eventId,
        caption: `${MARKER}-mixed`,
        rightsConfirmed: true,
        media: [
          { key: uploads[0].key, thumbKey: uploads[0].thumb!.key, contentType: 'image/jpeg' },
          { key: uploads[1].key, contentType: 'image/jpeg' },
        ],
      }),
    )
    expect(res.status).toBe(201)
    const { data: rows } = await db
      .from('memories')
      .select('media_url, thumb_url')
      .eq('caption', `${MARKER}-mixed`)
    // match rows by their media_url so the assertion never depends on row order
    const withThumb = rows!.find((r) => r.media_url === `https://media.test/${uploads[0].key}`)!
    const without = rows!.find((r) => r.media_url === `https://media.test/${uploads[1].key}`)!
    expect(withThumb.thumb_url).toBe(`https://media.test/${uploads[0].thumb!.key}`)
    expect(without.thumb_url).toBeNull()
  })

  test('a thumbKey outside the session grant → 403 (D21)', async () => {
    // presign without a thumb: the grant holds only the main key
    const { uploads, session } = await presignFiles([{ contentType: 'image/jpeg', size: 1000 }])
    const res = await createMemoriesHandler(deps())(
      post({
        session,
        eventId,
        caption: `${MARKER}-forged-thumb`,
        rightsConfirmed: true,
        media: [
          { key: uploads[0].key, thumbKey: 'm/2026/forged_t.webp', contentType: 'image/jpeg' },
        ],
      }),
    )
    expect(res.status).toBe(403)
    const { count } = await db
      .from('memories')
      .select('*', { count: 'exact', head: true })
      .eq('caption', `${MARKER}-forged-thumb`)
    expect(count).toBe(0) // rejected before insert
  })
})

describe('POST /api/memories — embed flow', () => {
  test('embed without a Turnstile token → 403', async () => {
    const res = await createMemoriesHandler(deps({ verifyTurnstile: deny }))(
      post({
        eventId,
        rightsConfirmed: true,
        embed: { url: 'https://youtu.be/dQw4w9WgXcQ' },
      }),
    )
    expect(res.status).toBe(403)
  })

  test('non-YouTube link → 400 (D9 P7)', async () => {
    const res = await createMemoriesHandler(deps())(
      post({
        turnstileToken: 't',
        eventId,
        rightsConfirmed: true,
        embed: { url: 'https://vimeo.com/12345' },
      }),
    )
    expect(res.status).toBe(400)
  })

  test('youtu.be short link is normalized to a canonical watch URL', async () => {
    const res = await createMemoriesHandler(deps())(
      post({
        turnstileToken: 't',
        eventId,
        caption: `${MARKER}-embed`,
        rightsConfirmed: true,
        embed: { url: 'https://youtu.be/dQw4w9WgXcQ', clipStart: 60, clipLength: 30 },
      }),
    )
    expect(res.status).toBe(201)
    const { data: row } = await db
      .from('memories')
      .select('media_kind, embed_url, clip_start, clip_length, media_url')
      .eq('caption', `${MARKER}-embed`)
      .single()
    expect(row!.media_kind).toBe('clip')
    expect(row!.embed_url).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    expect(row!.clip_start).toBe(60)
    expect(row!.clip_length).toBe(30)
    expect(row!.media_url).toBeNull()
  })
})

describe('write-time language detection (T3.3)', () => {
  test('a confidently-English caption stores source_lang=en', async () => {
    const caption = `the sunrise over the red stage was absolutely unreal ${MARKER}-lang`
    const res = await createMemoriesHandler(deps())(
      post({
        turnstileToken: 't',
        eventId,
        caption,
        rightsConfirmed: true,
        embed: { url: 'https://youtu.be/dQw4w9WgXcQ' },
      }),
    )
    expect(res.status).toBe(201)
    const { data } = await db.from('memories').select('source_lang').eq('caption', caption).single()
    expect(data!.source_lang).toBe('en')
  })
})

describe('passport attribution (T4.1)', () => {
  test('a valid anonymous-auth token links the moment to its author', async () => {
    const userClient = anon
    const { data: auth } = await createAnonClient().auth.signInAnonymously()
    void userClient
    const uid = auth.user!.id
    const token = auth.session!.access_token

    const caption = `${MARKER}-author`
    const res = await createMemoriesHandler(deps())(
      post({
        turnstileToken: 't',
        authToken: token,
        eventId,
        caption,
        rightsConfirmed: true,
        embed: { url: 'https://youtu.be/dQw4w9WgXcQ' },
      }),
    )
    expect(res.status).toBe(201)

    const { data: row } = await db
      .from('memories')
      .select('author_id')
      .eq('caption', caption)
      .single()
    expect(row!.author_id).toBe(uid)

    // the profile row is auto-created so the FK holds
    const { data: profile } = await db.from('profiles').select('id').eq('id', uid).single()
    expect(profile!.id).toBe(uid)

    await db.auth.admin.deleteUser(uid)
  })

  // docs/00 D43: attribution is best-effort. Since the wizard now always sends
  // a token (minting one if needed), a token we can't resolve — a stale session
  // whose anonymous user was deleted server-side, or a malformed one — must not
  // block the post. It publishes unattributed (author_id null), never 401s, so a
  // dead device session can't wedge uploads.
  test('an unresolvable auth token publishes unattributed, never 401s', async () => {
    const caption = `${MARKER}-badauthor`
    const res = await createMemoriesHandler(deps())(
      post({
        turnstileToken: 't',
        authToken: 'not-a-real-token',
        eventId,
        caption,
        rightsConfirmed: true,
        embed: { url: 'https://youtu.be/dQw4w9WgXcQ' },
      }),
    )
    expect(res.status).toBe(201)

    const { data: row } = await db
      .from('memories')
      .select('author_id')
      .eq('caption', caption)
      .single()
    expect(row!.author_id).toBeNull()
  })

  // Identity reuse (docs/00 D30, D31): an upload registers its name + handle +
  // home country on the author's profile so the next upload — and the passport
  // — pre-fill them.
  test('registers a trimmed display name, bare instagram handle, and home country on the profile', async () => {
    const { data: auth } = await createAnonClient().auth.signInAnonymously()
    const uid = auth.user!.id
    createdUserIds.push(uid)
    const token = auth.session!.access_token

    const res = await createMemoriesHandler(deps())(
      post({
        turnstileToken: 't',
        authToken: token,
        eventId,
        caption: `${MARKER}-register`,
        authorName: '  Neo  ',
        authorLink: '@neo_raver',
        country: 'nl',
        rightsConfirmed: true,
        embed: { url: 'https://youtu.be/dQw4w9WgXcQ' },
      }),
    )
    expect(res.status).toBe(201)

    const { data: profile } = await db
      .from('profiles')
      .select('display_name, instagram, home_country')
      .eq('id', uid)
      .single()
    expect(profile!.display_name).toBe('Neo') // trimmed
    expect(profile!.instagram).toBe('neo_raver') // bare handle — no "@", no URL
    expect(profile!.home_country).toBe('NL') // normalized ISO code (D31)
  })

  test('once registered, a later upload credits just that moment — it never overwrites the saved identity', async () => {
    const { data: auth } = await createAnonClient().auth.signInAnonymously()
    const uid = auth.user!.id
    createdUserIds.push(uid)
    const token = auth.session!.access_token
    const call = (body: Record<string, unknown>) =>
      createMemoriesHandler(deps())(
        post({
          turnstileToken: 't',
          authToken: token,
          eventId,
          rightsConfirmed: true,
          embed: { url: 'https://youtu.be/dQw4w9WgXcQ' },
          ...body,
        }),
      )

    // first upload registers all fields
    expect(
      (
        await call({
          caption: `${MARKER}-r1`,
          authorName: 'first',
          authorLink: 'first_ig',
          country: 'nl',
        })
      ).status,
    ).toBe(201)
    // second upload edits all (e.g. crediting a guest) — the profile must NOT
    // change, but the moment carries the edited credit (fill-empty, docs/00 D30/D31)
    expect(
      (
        await call({
          caption: `${MARKER}-r2`,
          authorName: 'guest',
          authorLink: 'guest_ig',
          country: 'de',
        })
      ).status,
    ).toBe(201)

    const { data: profile } = await db
      .from('profiles')
      .select('display_name, instagram, home_country')
      .eq('id', uid)
      .single()
    expect(profile!.display_name).toBe('first') // already set → not overwritten
    expect(profile!.instagram).toBe('first_ig') // already set → not overwritten
    expect(profile!.home_country).toBe('NL') // already set → 'de' ignored

    const { data: moment } = await db
      .from('memories')
      .select('author_name, author_link, origin_country')
      .eq('caption', `${MARKER}-r2`)
      .single()
    expect(moment!.author_name).toBe('guest') // the edit still credits this post
    expect(moment!.author_link).toBe('https://instagram.com/guest_ig')
    expect(moment!.origin_country).toBe('DE') // per-post country, even though the profile kept 'NL'
  })

  test('fills each field independently — a later upload registers a handle even after the name was set', async () => {
    const { data: auth } = await createAnonClient().auth.signInAnonymously()
    const uid = auth.user!.id
    createdUserIds.push(uid)
    const token = auth.session!.access_token
    const call = (body: Record<string, unknown>) =>
      createMemoriesHandler(deps())(
        post({
          turnstileToken: 't',
          authToken: token,
          eventId,
          rightsConfirmed: true,
          embed: { url: 'https://youtu.be/dQw4w9WgXcQ' },
          ...body,
        }),
      )

    // first upload sets only the name (no handle yet)
    expect((await call({ caption: `${MARKER}-n1`, authorName: 'onlyname' })).status).toBe(201)
    // later upload adds a handle — name stays (already set), handle fills (was empty)
    expect(
      (await call({ caption: `${MARKER}-n2`, authorName: 'ignored', authorLink: 'late_ig' }))
        .status,
    ).toBe(201)

    const { data: profile } = await db
      .from('profiles')
      .select('display_name, instagram')
      .eq('id', uid)
      .single()
    expect(profile!.display_name).toBe('onlyname') // already set → kept, not 'ignored'
    expect(profile!.instagram).toBe('late_ig') // was empty → registered
  })
})

describe('rate limiting (D9 P4)', () => {
  test('11th upload within an hour → 429 on both endpoints', async () => {
    const rateHash = hashIp(RATE_IP, 'upload')
    await db.from('upload_events').insert(Array.from({ length: 10 }, () => ({ ip_hash: rateHash })))

    const presign = await createPresignHandler(deps())(
      new Request('http://localhost/api/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': RATE_IP },
        body: JSON.stringify({
          turnstileToken: 't',
          files: [{ contentType: 'image/jpeg', size: 1000 }],
        }),
      }),
    )
    expect(presign.status).toBe(429)

    const memories = await createMemoriesHandler(deps())(
      new Request('http://localhost/api/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': RATE_IP },
        body: JSON.stringify({
          turnstileToken: 't',
          eventId,
          rightsConfirmed: true,
          embed: { url: 'https://youtu.be/dQw4w9WgXcQ' },
        }),
      }),
    )
    expect(memories.status).toBe(429)
  })

  test('the file flow is NOT re-rate-limited at memories — presign already counted it (off-by-one)', async () => {
    const ip = `10.20.${runId}.7`
    const rateHash = hashIp(ip, 'upload')
    const headers = { 'x-forwarded-for': ip }
    // one below the limit → the next presign is the last allowed upload
    await db
      .from('upload_events')
      .insert(Array.from({ length: UPLOADS_PER_HOUR - 1 }, () => ({ ip_hash: rateHash })))

    try {
      // allowed (count was limit-1), and it records the event → now exactly at limit
      const presign = await createPresignHandler(deps())(
        post({ turnstileToken: 't', files: [{ contentType: 'image/jpeg', size: 1000 }] }, headers),
      )
      expect(presign.status).toBe(200)
      const { uploads, session } = await presign.json()

      // Committing that SAME upload must succeed: re-checking the rate here would
      // 429 the last allowed upload AFTER its bytes are already in R2 (orphan).
      const memories = await createMemoriesHandler(deps())(
        post(
          {
            session,
            eventId,
            caption: `${MARKER}-offbyone`,
            rightsConfirmed: true,
            media: uploads.map((u: { key: string }) => ({ key: u.key, contentType: 'image/jpeg' })),
          },
          headers,
        ),
      )
      expect(memories.status).toBe(201)
    } finally {
      // always clear the seeded rate rows, even if an assertion above throws
      await db.from('upload_events').delete().eq('ip_hash', rateHash)
    }
  })

  test('presign records a rate event so minting R2 grants is bounded', async () => {
    const presignIp = `10.20.${runId}.9`
    const before = await db
      .from('upload_events')
      .select('*', { count: 'exact', head: true })
      .eq('ip_hash', hashIp(presignIp, 'upload'))

    const res = await createPresignHandler(deps())(
      new Request('http://localhost/api/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': presignIp },
        body: JSON.stringify({
          turnstileToken: 't',
          files: [{ contentType: 'image/jpeg', size: 1000 }],
        }),
      }),
    )
    expect(res.status).toBe(200)

    const after = await db
      .from('upload_events')
      .select('*', { count: 'exact', head: true })
      .eq('ip_hash', hashIp(presignIp, 'upload'))
    expect((after.count ?? 0) - (before.count ?? 0)).toBe(1)

    await db.from('upload_events').delete().eq('ip_hash', hashIp(presignIp, 'upload'))
  })
})

describe('POST /api/report — server-computed reporter_hint', () => {
  // A report can trip the auto-hide trigger, which lowers the live count — so
  // the handler carries the same counters seam as publish/admin (docs/00 D41).
  function reportDeps(overrides: Partial<ReportDeps> = {}): ReportDeps {
    return { db, revalidate: (tag) => revalidated.push(tag), ...overrides }
  }

  async function fixtureMemory(caption: string): Promise<string> {
    return seedMemory(db, { event_id: eventId, caption })
  }

  test('files a report with the hint derived from the real IP', async () => {
    const memoryId = await fixtureMemory(`${MARKER}-report`)
    const res = await createReportHandler(reportDeps())(
      new Request('http://localhost/api/report', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': `${REPORT_IP_BASE}.0` },
        body: JSON.stringify({ memoryId, reason: 'spam' }),
      }),
    )
    expect(res.status).toBe(201)
    const { data: report } = await db
      .from('reports')
      .select('reporter_hint, reason')
      .eq('memory_id', memoryId)
      .single()
    expect(report!.reason).toBe('spam')
    expect(report!.reporter_hint).toBe(hashIp(`${REPORT_IP_BASE}.0`, 'reporter'))
  })

  test('invalid reason and unknown memory → 400', async () => {
    const memoryId = await fixtureMemory(`${MARKER}-report-bad`)
    const badReason = await createReportHandler(reportDeps())(
      post({ memoryId, reason: 'i-just-dislike-it' }),
    )
    expect(badReason.status).toBe(400)

    const unknown = await createReportHandler(reportDeps())(
      post({ memoryId: randomUUID(), reason: 'spam' }),
    )
    expect(unknown.status).toBe(400)
  })

  test('3 reports from 3 real IPs auto-hide the memory (threshold via the route)', async () => {
    const memoryId = await fixtureMemory(`${MARKER}-report-threshold`)
    for (const i of [1, 2, 3]) {
      const res = await createReportHandler(reportDeps())(
        new Request('http://localhost/api/report', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-forwarded-for': `${REPORT_IP_BASE}.${i}`,
          },
          body: JSON.stringify({ memoryId, reason: 'nsfw' }),
        }),
      )
      expect(res.status).toBe(201)
    }
    const { data } = await db.from('memories').select('status').eq('id', memoryId).single()
    expect(data!.status).toBe('hidden')

    const { data: anonView } = await anon.from('memories').select('id').eq('id', memoryId)
    expect(anonView ?? []).toHaveLength(0)

    // The auto-hide dropped the live count, so the cached counters must have
    // been invalidated (docs/00 D41) — otherwise the wall header keeps counting
    // a moment that's no longer on the wall for up to the cache window.
    expect(revalidated).toContain('counters')
  })

  test('a filed report fires a best-effort Discord alert linking the moment (D36)', async () => {
    const notify = vi.fn(async (_msg: unknown) => {})
    const memoryId = await fixtureMemory(`${MARKER}-report-discord`)
    const res = await createReportHandler(reportDeps({ notify }))(
      new Request('http://localhost/api/report', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': `${REPORT_IP_BASE}.4` },
        body: JSON.stringify({ memoryId, reason: 'spam' }),
      }),
    )
    expect(res.status).toBe(201)
    expect(notify).toHaveBeenCalledTimes(1)
    const msg = notify.mock.calls[0][0] as { embeds: Array<{ url: string }> }
    expect(msg.embeds[0].url).toContain(`/m/${memoryId}`)
  })
})
