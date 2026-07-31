import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { StorageAdapter } from '@/lib/storage'
import { createPassportMergeHandler } from '@/server/passport-merge'
import { createMemoriesHandler } from '@/server/upload'
import { createAnonClient, createServiceClient, eventIdByYear, seedMemory } from './helpers'

/**
 * /api/passport/merge — D44, and the record that makes it survivable (D45).
 * Signing into an existing account from a device that holds an anonymous
 * passport folds that passport in: its identity, uploads and stamps move to the
 * target, then it's deleted. Runs against the real stack so the FK
 * reassignment, the attendance PK dedup, the timestamp carry and the cascade
 * delete are exercised for real (a stub can't prove the ownership move survives
 * the delete).
 */

const service = createServiceClient()
const notified: string[] = []
const handler = createPassportMergeHandler({
  db: service,
  notify: async (m) => {
    notified.push(m.content ?? '')
  },
})

/** Obviously-not-now timestamps, so a reset to now() can't pass by accident. */
const STAMPED_AT = '2022-06-24T12:00:00+00:00'
const TARGET_STAMPED_AT = '2019-06-28T12:00:00+00:00'

let e2018: string
let e2019: string
let e2022: string
const memoryIds: string[] = []
const userIds: string[] = []

function mergeRequest(bearer: string, body: unknown): Request {
  return new Request('http://localhost/api/passport/merge', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` },
    body: JSON.stringify(body),
  })
}

/** A real anonymous passport with a profile row, returned with its token. */
async function newAnon(
  displayName: string,
  identity: { instagram?: string; home_country?: string } = {},
): Promise<{ id: string; token: string }> {
  const client = createAnonClient()
  const { data, error } = await client.auth.signInAnonymously()
  if (error || !data.user || !data.session) throw new Error(`anon fixture: ${error?.message}`)
  const id = data.user.id
  userIds.push(id)
  await service.from('profiles').upsert({ id, display_name: displayName, ...identity })
  return { id, token: data.session.access_token }
}

/** A real email account (non-anonymous), returned with a bearer token. */
async function newEmailUser(displayName: string): Promise<{ id: string; token: string }> {
  const email = `merge-${randomUUID().slice(0, 8)}@test.onetribe`
  const password = `pw-${randomUUID()}`
  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (error || !data.user) throw new Error(`email fixture: ${error?.message}`)
  const id = data.user.id
  userIds.push(id)
  await service.from('profiles').upsert({ id, display_name: displayName })
  const client = createAnonClient()
  const { data: auth } = await client.auth.signInWithPassword({ email, password })
  if (!auth.session) throw new Error('email fixture: no session')
  return { id, token: auth.session.access_token }
}

/** Seeds attendance rows, refusing to continue on a silent write error. */
async function stamp(
  rows: Array<{ profile_id: string; event_id: string; created_at: string }>,
): Promise<void> {
  const { error } = await service.from('attendance').upsert(rows)
  if (error) throw new Error(`attendance fixture: ${error.message}`)
}

async function stampsOf(profileId: string): Promise<string[]> {
  const { data } = await service.from('attendance').select('event_id').eq('profile_id', profileId)
  return (data ?? []).map((r) => r.event_id).sort()
}

async function stampedAt(profileId: string, eventId: string): Promise<string | null> {
  const { data } = await service
    .from('attendance')
    .select('created_at')
    .eq('profile_id', profileId)
    .eq('event_id', eventId)
    .maybeSingle()
  return data?.created_at ?? null
}

/** The publish route with its external boundaries faked — the embed flow needs
 *  no storage, so this is enough to exercise attribution end to end. */
const publishDeps = {
  storage: {
    presignUpload: async () => {
      throw new Error('unused')
    },
    publicUrl: (key: string) => `https://media.test/${key}`,
    keyForUrl: () => null,
    deleteObject: async () => {},
  } as unknown as StorageAdapter,
  verifyTurnstile: async () => true,
  db: service,
  sessionSecret: 'test-secret',
  revalidate: () => {},
}

function publishEmbed(caption: string, eventId: string, authToken: string): Request {
  return new Request('http://localhost/api/memories', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.44.0.1' },
    body: JSON.stringify({
      turnstileToken: 't',
      authToken,
      eventId,
      caption,
      rightsConfirmed: true,
      embed: { url: 'https://youtu.be/dQw4w9WgXcQ' },
    }),
  })
}

beforeAll(async () => {
  ;[e2018, e2019, e2022] = await Promise.all([
    eventIdByYear(service, 2018),
    eventIdByYear(service, 2019),
    eventIdByYear(service, 2022),
  ])
})

afterAll(async () => {
  await service.from('memories').delete().in('id', memoryIds)
  await service.from('passport_merges').delete().in('source_id', userIds)
  for (const id of userIds) await service.auth.admin.deleteUser(id).catch(() => {})
})

describe('passport merge route', () => {
  test('folds an anonymous passport into the signed-in account', async () => {
    const target = await newEmailUser('returning warrior')
    const source = await newAnon('this device', { instagram: 'raver', home_country: 'NL' })
    // target already attended 2018 + 2019
    await stamp([
      { profile_id: target.id, event_id: e2018, created_at: TARGET_STAMPED_AT },
      { profile_id: target.id, event_id: e2019, created_at: TARGET_STAMPED_AT },
    ])
    // the anonymous passport uploaded a moment and stamped 2018 (overlap) + 2022 (new)
    const movedMemory = await seedMemory(service, {
      event_id: e2022,
      caption: `merge-src-${randomUUID().slice(0, 8)}`,
      author_id: source.id,
      author_name: 'this device',
    })
    memoryIds.push(movedMemory)
    // every row carries the same keys — PostgREST rejects a bulk write whose
    // objects disagree, and an unchecked error here would look like a merge bug
    await stamp([
      { profile_id: source.id, event_id: e2018, created_at: '2018-06-24T12:00:00+00:00' },
      { profile_id: source.id, event_id: e2022, created_at: STAMPED_AT },
    ])
    // a bystander's moment on another anonymous passport — reassignment must
    // scope to the source only (a bug here would re-home the whole wall)
    const bystander = await newAnon('someone else')
    const bystanderMemory = await seedMemory(service, {
      event_id: e2019,
      caption: `merge-bystander-${randomUUID().slice(0, 8)}`,
      author_id: bystander.id,
      author_name: 'someone else',
    })
    memoryIds.push(bystanderMemory)

    const res = await handler(mergeRequest(target.token, { anonToken: source.token }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(notified).toEqual([])

    // the moment now belongs to the target; wall credit stays as posted
    const { data: moment } = await service
      .from('memories')
      .select('author_id, author_name')
      .eq('id', movedMemory)
      .single()
    expect(moment?.author_id).toBe(target.id)
    expect(moment?.author_name).toBe('this device')

    // stamps are the union, deduped — 2018 appears once, 2022 carried over
    expect(await stampsOf(target.id)).toEqual([e2018, e2019, e2022].sort())
    // ...carrying the day it was earned, not the day the passports merged
    expect(await stampedAt(target.id, e2022)).toBe(STAMPED_AT)

    // the identity typed on this device survives the delete below, filling only
    // what the target never had (docs/00 D30 fill-empty)
    const { data: identity } = await service
      .from('profiles')
      .select('display_name, instagram, home_country')
      .eq('id', target.id)
      .single()
    expect(identity).toEqual({
      display_name: 'returning warrior',
      instagram: 'raver',
      home_country: 'NL',
    })

    // the pairing is on record — the one thing that outlives the source
    const { data: record } = await service
      .from('passport_merges')
      .select('target_id')
      .eq('source_id', source.id)
      .single()
    expect(record?.target_id).toBe(target.id)

    // the anonymous source is gone: auth user, profile, and its leftover stamps
    const { data: ghost } = await service.auth.admin.getUserById(source.id)
    expect(ghost.user).toBeNull()
    const { data: srcProfile } = await service.from('profiles').select('id').eq('id', source.id)
    expect(srcProfile).toHaveLength(0)
    expect(await stampsOf(source.id)).toEqual([])

    // the bystander is untouched
    const { data: other } = await service
      .from('memories')
      .select('author_id')
      .eq('id', bystanderMemory)
      .single()
    expect(other?.author_id).toBe(bystander.id)
  })

  test('an upload still in flight when the merge ran lands in the account', async () => {
    // The wizard captures the passport token at submit start — before
    // compression, presign and the PUTs. A sign-in completed on this device
    // meanwhile deletes that passport, so by the time the publish lands the
    // token resolves to nobody. Without the merge record the moment publishes
    // permanently unattributed: the exact loss D44 exists to prevent, arriving
    // through the door D44 opened (docs/00 D45).
    const target = await newEmailUser('the account')
    const source = await newAnon('mid-upload')
    const inFlightToken = source.token

    const merged = await handler(mergeRequest(target.token, { anonToken: source.token }))
    expect(merged.status).toBe(200)

    const caption = `merge-inflight-${randomUUID().slice(0, 8)}`
    const res = await createMemoriesHandler(publishDeps)(
      publishEmbed(caption, e2019, inFlightToken),
    )
    expect(res.status).toBe(201)

    const { data: row } = await service
      .from('memories')
      .select('id, author_id')
      .eq('caption', caption)
      .single()
    memoryIds.push(row!.id)
    expect(row!.author_id).toBe(target.id)
  })

  test('a token that was never merged still publishes unattributed', async () => {
    // the mapping must not become a way to attribute an arbitrary dead token —
    // only one that was actually folded in matches
    const caption = `merge-unmatched-${randomUUID().slice(0, 8)}`
    const stale = await newAnon('gone')
    await service.auth.admin.deleteUser(stale.id)

    const res = await createMemoriesHandler(publishDeps)(publishEmbed(caption, e2019, stale.token))
    expect(res.status).toBe(201)

    const { data: row } = await service
      .from('memories')
      .select('id, author_id')
      .eq('caption', caption)
      .single()
    memoryIds.push(row!.id)
    expect(row!.author_id).toBeNull()
  })

  test('refuses an ANONYMOUS target — a throwaway passport can never absorb', async () => {
    const target = await newAnon('throwaway')
    const source = await newAnon('the other one')
    const res = await handler(mergeRequest(target.token, { anonToken: source.token }))
    expect(res.status).toBe(403)

    const { data: alive } = await service.auth.admin.getUserById(source.id)
    expect(alive.user?.id).toBe(source.id)
  })

  test('refuses to absorb a NON-anonymous source (403) and touches nothing', async () => {
    const target = await newEmailUser('target')
    // a second real account — holding its token must not let it be folded in + deleted
    const victim = await newEmailUser('a real account')
    const victimMemory = await seedMemory(service, {
      event_id: e2018,
      caption: `merge-victim-${randomUUID().slice(0, 8)}`,
      author_id: victim.id,
      author_name: 'a real account',
    })
    memoryIds.push(victimMemory)

    const res = await handler(mergeRequest(target.token, { anonToken: victim.token }))
    expect(res.status).toBe(403)

    // the "source" still exists and keeps its moment
    const { data: alive } = await service.auth.admin.getUserById(victim.id)
    expect(alive.user?.id).toBe(victim.id)
    const { data: kept } = await service
      .from('memories')
      .select('author_id')
      .eq('id', victimMemory)
      .single()
    expect(kept?.author_id).toBe(victim.id)
  })

  test('missing anonToken → 400', async () => {
    const target = await newEmailUser('target')
    const res = await handler(mergeRequest(target.token, {}))
    expect(res.status).toBe(400)
  })

  test('garbage anonToken → 401', async () => {
    const target = await newEmailUser('target')
    const res = await handler(mergeRequest(target.token, { anonToken: 'not-a-jwt' }))
    expect(res.status).toBe(401)
  })
})
