import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createPassportMergeHandler } from '@/server/passport-merge'
import { createAnonClient, createServiceClient, eventIdByYear, seedMemory } from './helpers'

/**
 * /api/passport/merge — D44. Signing into an existing account from a device
 * that holds an anonymous passport folds that passport in: its uploads and
 * stamps move to the target, then it's deleted. Runs against the real stack so
 * the FK reassignment, the attendance PK dedup, and the cascade delete are
 * exercised for real (a stub can't prove the ownership move survives the delete).
 */

const service = createServiceClient()
const handler = createPassportMergeHandler({ db: service })

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
async function newAnon(displayName: string): Promise<{ id: string; token: string }> {
  const client = createAnonClient()
  const { data, error } = await client.auth.signInAnonymously()
  if (error || !data.user || !data.session) throw new Error(`anon fixture: ${error?.message}`)
  const id = data.user.id
  userIds.push(id)
  await service.from('profiles').upsert({ id, display_name: displayName })
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

async function stampsOf(profileId: string): Promise<string[]> {
  const { data } = await service.from('attendance').select('event_id').eq('profile_id', profileId)
  return (data ?? []).map((r) => r.event_id).sort()
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
  for (const id of userIds) await service.auth.admin.deleteUser(id).catch(() => {})
})

describe('passport merge route', () => {
  test('folds an anonymous passport into the signed-in account', async () => {
    const target = await newEmailUser('returning warrior')
    const source = await newAnon('this device')
    // target already attended 2018 + 2019
    await service.from('attendance').upsert([
      { profile_id: target.id, event_id: e2018 },
      { profile_id: target.id, event_id: e2019 },
    ])
    // the anonymous passport uploaded a moment and stamped 2018 (overlap) + 2022 (new)
    const movedMemory = await seedMemory(service, {
      event_id: e2022,
      caption: `merge-src-${randomUUID().slice(0, 8)}`,
      author_id: source.id,
      author_name: 'this device',
    })
    memoryIds.push(movedMemory)
    await service.from('attendance').upsert([
      { profile_id: source.id, event_id: e2018 },
      { profile_id: source.id, event_id: e2022 },
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
    expect(await res.json()).toEqual({ ok: true, memories: 1, stamps: 2 })

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
