import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { hashIp } from '@/lib/server/request-meta'
import type { StorageAdapter } from '@/lib/storage'
import {
  createMemoriesHandler,
  createPresignHandler,
  createReportHandler,
  type UploadDeps,
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

const fakeStorage: StorageAdapter = {
  async presignUpload({ key, contentType, contentLength }) {
    return {
      key,
      uploadUrl: `https://fake-storage.test/put/${key}`,
      headers: { 'content-type': contentType, 'content-length': String(contentLength) },
    }
  },
  publicUrl: (key) => `https://media.test/${key}`,
}

const allow = async () => true
const deny = async () => false

function deps(overrides: Partial<UploadDeps> = {}): UploadDeps {
  return {
    storage: fakeStorage,
    verifyTurnstile: allow,
    db,
    sessionSecret: 'test-secret',
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
  files: Array<{ contentType: string; size: number }>,
): Promise<{ uploads: Array<{ key: string }>; session: string }> {
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

afterAll(async () => {
  await db.from('memories').delete().like('caption', `%${MARKER}%`)
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

  test('happy path: batch of 2 → 2 live rows, derived URLs, geo country, IG link normalized', async () => {
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
          authorLink: '@onetribe.dance',
          rightsConfirmed: true,
          media: [
            { key: uploads[0].key, contentType: 'image/jpeg' },
            { key: uploads[1].key, contentType: 'image/gif' },
          ],
        },
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
      .select('media_kind, media_url, status, origin_country, author_link, author_name')
      .eq('caption', `${MARKER}-happy`)
    expect(rows).toHaveLength(2)
    // enum columns sort by definition order, so compare as a set
    expect(rows!.map((r) => r.media_kind).sort()).toEqual(['gif', 'image'])
    for (const row of rows!) {
      expect(row.status).toBe('live')
      expect(row.media_url).toMatch(/^https:\/\/media\.test\/m\/\d{4}\//)
      expect(row.origin_country).toBe('KR')
      expect(row.author_link).toBe('https://instagram.com/onetribe.dance')
      expect(row.author_name).toBe('tester')
    }
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

  test('an invalid auth token is rejected, not silently dropped', async () => {
    const res = await createMemoriesHandler(deps())(
      post({
        turnstileToken: 't',
        authToken: 'not-a-real-token',
        eventId,
        caption: `${MARKER}-badauthor`,
        rightsConfirmed: true,
        embed: { url: 'https://youtu.be/dQw4w9WgXcQ' },
      }),
    )
    expect(res.status).toBe(401)
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
})

describe('POST /api/report — server-computed reporter_hint', () => {
  async function fixtureMemory(caption: string): Promise<string> {
    return seedMemory(db, { event_id: eventId, caption })
  }

  test('files a report with the hint derived from the real IP', async () => {
    const memoryId = await fixtureMemory(`${MARKER}-report`)
    const res = await createReportHandler({ db })(
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
    const badReason = await createReportHandler({ db })(
      post({ memoryId, reason: 'i-just-dislike-it' }),
    )
    expect(badReason.status).toBe(400)

    const unknown = await createReportHandler({ db })(
      post({ memoryId: randomUUID(), reason: 'spam' }),
    )
    expect(unknown.status).toBe(400)
  })

  test('3 reports from 3 real IPs auto-hide the memory (threshold via the route)', async () => {
    const memoryId = await fixtureMemory(`${MARKER}-report-threshold`)
    for (const i of [1, 2, 3]) {
      const res = await createReportHandler({ db })(
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
  })
})
