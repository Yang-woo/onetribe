import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createAdminActionHandler } from '@/server/admin'
import { createMomentRemoveHandler } from '@/server/moments'
import type { StorageAdapter } from '@/lib/storage'
import {
  createAnonClient,
  createServiceClient,
  eventIdByYear,
  memoryState,
  seedMemory,
} from './helpers'

/**
 * Provenance on a hidden row — docs/00 D55.
 *
 * Four paths hide a moment and they used to be indistinguishable afterwards,
 * which is what made an author's deliberate removal look like a filter mistake
 * in the operator console. The first attempt at this let each of the four write
 * the label, and four writers means last-writer-wins: a takedown link clicked
 * after a policy hide relabelled it as the uploader's own doing.
 *
 * So the label belongs to the database, and these tests drive the real one.
 * Two properties carry the whole design:
 *
 *   1. While a moment is down its label cannot change — not through a route,
 *      not through the RPC, not through a direct write with the service role.
 *      Anything that would relabel it is silently normalised away.
 *   2. Putting a moment back that a *person* took down is refused by the
 *      database until the caller names what it is overruling. The browser
 *      prompt sits on top of that refusal; it is not the refusal.
 */

const service = createServiceClient()
const anon = createAnonClient()

const noStorage = {
  deleteObject: async () => {},
  keyForUrl: () => null,
} as unknown as StorageAdapter

const OPERATOR = `op-${randomUUID().slice(0, 8)}@onetribe.world`
const adminAction = createAdminActionHandler({
  db: service,
  adminEmails: [OPERATOR],
  storage: noStorage,
  revalidate: () => {},
})
const removeOwn = createMomentRemoveHandler({ db: service, revalidate: () => {} })

let eventId: string
let operatorToken: string
const memoryIds: string[] = []
const userIds: string[] = []

async function newPassport(name: string) {
  const client = createAnonClient()
  const { data, error } = await client.auth.signInAnonymously()
  if (error || !data.user || !data.session) throw new Error(`passport: ${error?.message}`)
  userIds.push(data.user.id)
  await service.from('profiles').insert({ id: data.user.id, display_name: name })
  return { userId: data.user.id, token: data.session.access_token }
}

async function seed(overrides: Record<string, unknown> = {}) {
  const id = await seedMemory(service, {
    event_id: eventId,
    caption: `reason-${randomUUID().slice(0, 8)}`,
    ...overrides,
  })
  memoryIds.push(id)
  return id
}

function admin(memoryId: string, action: string, acknowledge?: string): Request {
  return new Request('http://localhost/api/admin/action', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${operatorToken}` },
    body: JSON.stringify({ memoryId, action, ...(acknowledge ? { acknowledge } : {}) }),
  })
}

function removeRequest(memoryId: string, token: string): Request {
  return new Request('http://localhost/api/memories/remove', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ memoryId }),
  })
}

async function reportOnce(memoryId: string, hint: string) {
  const { error } = await service
    .from('reports')
    .insert({ memory_id: memoryId, reason: 'spam', reporter_hint: `${hint}-${memoryId}` })
  if (error) throw new Error(`report fixture: ${error.message}`)
}

/** Trip the 3-distinct-reporter auto-hide (docs/09 A-2). */
async function reportThreeTimes(memoryId: string) {
  for (const hint of ['a', 'b', 'c']) await reportOnce(memoryId, hint)
}

async function takedownToken(memoryId: string): Promise<string> {
  const { data } = await service
    .from('memories')
    .select('takedown_token')
    .eq('id', memoryId)
    .single()
  return data!.takedown_token as string
}

async function reportCount(memoryId: string): Promise<number> {
  const { count } = await service
    .from('reports')
    .select('*', { count: 'exact', head: true })
    .eq('memory_id', memoryId)
  return count ?? 0
}

beforeAll(async () => {
  eventId = await eventIdByYear(service, 2022)
  const password = `op-${randomUUID()}`
  const { data, error } = await service.auth.admin.createUser({
    email: OPERATOR,
    password,
    email_confirm: true,
  })
  if (error || !data.user) throw new Error(`operator fixture: ${error?.message}`)
  userIds.push(data.user.id)
  const { data: auth } = await createAnonClient().auth.signInWithPassword({
    email: OPERATOR,
    password,
  })
  operatorToken = auth.session!.access_token
})

afterAll(async () => {
  if (memoryIds.length) await service.from('memories').delete().in('id', memoryIds)
  for (const id of userIds) await service.auth.admin.deleteUser(id).catch(() => {})
})

describe('each path signs its own work', () => {
  test('the author removing their own moment records "owner"', async () => {
    const owner = await newPassport('reason-owner')
    const memoryId = await seed({ author_id: owner.userId })

    const res = await removeOwn(removeRequest(memoryId, owner.token))

    expect(res.status).toBe(200)
    expect(await memoryState(service, memoryId)).toEqual({
      status: 'hidden',
      hidden_reason: 'owner',
    })
  })

  test('the takedown token records "token", not "owner"', async () => {
    const memoryId = await seed()

    const { data: ok } = await anon.rpc('takedown_memory', {
      p_memory_id: memoryId,
      p_token: await takedownToken(memoryId),
    })

    expect(ok).toBe(true)
    // the two uploader-driven paths stay distinguishable: only one of them
    // proves who is holding the link
    expect(await memoryState(service, memoryId)).toEqual({
      status: 'hidden',
      hidden_reason: 'token',
    })
  })

  test('the report threshold records "report"', async () => {
    const memoryId = await seed()
    await reportThreeTimes(memoryId)
    expect(await memoryState(service, memoryId)).toEqual({
      status: 'hidden',
      hidden_reason: 'report',
    })
  })

  test('the operator hiding by hand records "operator"', async () => {
    const memoryId = await seed()
    expect((await adminAction(admin(memoryId, 'hide'))).status).toBe(200)
    expect(await memoryState(service, memoryId)).toEqual({
      status: 'hidden',
      hidden_reason: 'operator',
    })
  })
})

describe('while a moment is down, its label cannot change', () => {
  test('a takedown link cannot launder a policy hide into the uploader’s own choice', async () => {
    // The exact hole the first attempt had. takedown_token is not proof of
    // authorship — it rides in a URL — so a leaked link must not be able to
    // turn a hide the community earned into one the console offers to undo.
    const memoryId = await seed()
    await reportThreeTimes(memoryId)

    const { data: ok } = await anon.rpc('takedown_memory', {
      p_memory_id: memoryId,
      p_token: await takedownToken(memoryId),
    })

    // still true — a valid token on an already-hidden moment is not an error,
    // it just buys nothing
    expect(ok).toBe(true)
    expect(await memoryState(service, memoryId)).toEqual({
      status: 'hidden',
      hidden_reason: 'report',
    })
  })

  test('three passers-by cannot relabel a moment its author took down', async () => {
    const owner = await newPassport('reason-relabel')
    const memoryId = await seed({ author_id: owner.userId })
    await removeOwn(removeRequest(memoryId, owner.token))

    await reportThreeTimes(memoryId)

    expect(await memoryState(service, memoryId)).toEqual({
      status: 'hidden',
      hidden_reason: 'owner',
    })
  })

  test('the operator’s own hide cannot repaint an author’s takedown', async () => {
    const owner = await newPassport('reason-operator-over')
    const memoryId = await seed({ author_id: owner.userId })
    await removeOwn(removeRequest(memoryId, owner.token))

    expect((await adminAction(admin(memoryId, 'hide'))).status).toBe(200)

    expect(await memoryState(service, memoryId)).toEqual({
      status: 'hidden',
      hidden_reason: 'owner',
    })
  })

  test('the author still succeeds on a moment that is already down, without repainting it', async () => {
    const owner = await newPassport('reason-owner-late')
    const memoryId = await seed({ author_id: owner.userId })
    await reportThreeTimes(memoryId)

    const res = await removeOwn(removeRequest(memoryId, owner.token))

    // "it is off the wall" is the truth and the only thing they asked for; a
    // 404 here would read as "we lost your moment"
    expect(res.status).toBe(200)
    expect(await memoryState(service, memoryId)).toEqual({
      status: 'hidden',
      hidden_reason: 'report',
    })
  })

  test('a direct column write is normalised away — even with the service role', async () => {
    // No route does this. That is the point: the guard is not a convention the
    // four callers keep, so a fifth writer — a script, the dashboard, a route
    // nobody has written yet — cannot break the invariant either.
    const memoryId = await seed()
    await reportThreeTimes(memoryId)

    const { error } = await service
      .from('memories')
      .update({ hidden_reason: 'owner' })
      .eq('id', memoryId)

    expect(error).toBeNull() // silently normalised, not rejected
    expect(await memoryState(service, memoryId)).toEqual({
      status: 'hidden',
      hidden_reason: 'report',
    })
  })

  test('three reports do not touch a moment awaiting review', async () => {
    // The report trigger keeps a guard of its own, and since the column guard
    // took over protecting the label this is the only thing that guard still
    // does: a 'flagged' row is the v2 auto-filter's "a human should look at
    // this", and three reports must not quietly convert it into a plain hide.
    // Nothing writes 'flagged' yet, so without this the guard could be deleted
    // with every test still green — and the migration comment claims it.
    const memoryId = await seed()
    await service.from('memories').update({ status: 'flagged' }).eq('id', memoryId)

    await reportThreeTimes(memoryId)

    expect(await memoryState(service, memoryId)).toEqual({
      status: 'flagged',
      hidden_reason: null,
    })
  })

  test('an unknown reason is refused even where the CHECK constraint cannot see it', async () => {
    const memoryId = await seed()
    await reportThreeTimes(memoryId)

    // On an already-hidden row the guard swaps the bad value for the old one
    // before the constraint ever looks, so a typo would otherwise "succeed"
    // and quietly disable the refusal that protects that row.
    const { error } = await service.rpc('hide_memory', {
      p_memory_id: memoryId,
      p_reason: 'ownerr',
    })

    expect(error?.code).toBe('22023')
    expect(await memoryState(service, memoryId)).toEqual({
      status: 'hidden',
      hidden_reason: 'report',
    })
  })

  test('the column refuses a reason nobody defined', async () => {
    const memoryId = await seed()
    const { error } = await service
      .from('memories')
      .update({ status: 'hidden', hidden_reason: 'whoops' })
      .eq('id', memoryId)
    expect(error?.code).toBe('23514')
  })
})

describe('restoring is refused, by the database, not by the browser', () => {
  async function hiddenByOwner() {
    const owner = await newPassport(`ack-${randomUUID().slice(0, 6)}`)
    const memoryId = await seed({ author_id: owner.userId })
    await removeOwn(removeRequest(memoryId, owner.token))
    return memoryId
  }

  test('an author’s takedown is not restored by asking plainly', async () => {
    const memoryId = await hiddenByOwner()

    const res = await adminAction(admin(memoryId, 'unhide'))

    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'confirm required', reason: 'owner' })
    // and the moment is still off the wall — a refusal that half-applied would
    // be worse than none
    expect(await memoryState(service, memoryId)).toEqual({
      status: 'hidden',
      hidden_reason: 'owner',
    })
  })

  test('acknowledging the wrong thing is refused too', async () => {
    const memoryId = await hiddenByOwner()

    // compare-and-set: this is what a console holding a stale snapshot sends,
    // and it must not be taken as consent for a decision it never saw
    const res = await adminAction(admin(memoryId, 'unhide', 'token'))

    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'confirm required', reason: 'owner' })
  })

  test('naming it restores it — the gate is a question, not a lock', async () => {
    const memoryId = await hiddenByOwner()

    const res = await adminAction(admin(memoryId, 'unhide', 'owner'))

    expect(res.status).toBe(200)
    // restoring clears the label with the status it explains: "its author took
    // this down" on a live moment would be a lie
    expect(await memoryState(service, memoryId)).toEqual({ status: 'live', hidden_reason: null })
  })

  test('a takedown-link removal is refused the same way', async () => {
    const memoryId = await seed()
    await anon.rpc('takedown_memory', {
      p_memory_id: memoryId,
      p_token: await takedownToken(memoryId),
    })

    const refused = await adminAction(admin(memoryId, 'unhide'))
    expect(refused.status).toBe(409)
    expect((await refused.json()).reason).toBe('token')

    expect((await adminAction(admin(memoryId, 'unhide', 'token'))).status).toBe(200)
  })

  test('a moment hidden before this column existed is refused as "unknown"', async () => {
    // The fail-open that shipped in the first attempt: no label meant no
    // prompt, so every row hidden before the migration — the token-era rows
    // the prompt exists for — stayed one keypress from the wall.
    const memoryId = await seed()
    await service.from('memories').update({ status: 'hidden' }).eq('id', memoryId)
    expect(await memoryState(service, memoryId)).toEqual({
      status: 'hidden',
      hidden_reason: null,
    })

    const refused = await adminAction(admin(memoryId, 'unhide'))
    expect(refused.status).toBe(409)
    expect((await refused.json()).reason).toBe('unknown')

    expect((await adminAction(admin(memoryId, 'unhide', 'unknown'))).status).toBe(200)
  })

  test.each([
    ['report', async (id: string) => reportThreeTimes(id)],
    ['operator', async (id: string) => void (await adminAction(admin(id, 'hide')))],
  ])('moderation’s own %s hide restores without a question', async (reason, hide) => {
    const memoryId = await seed()
    await hide(memoryId)
    expect((await memoryState(service, memoryId)).hidden_reason).toBe(reason)

    // asking on every row is asking on none — this is the flow that has to stay
    // frictionless for the gate above to mean anything
    expect((await adminAction(admin(memoryId, 'unhide'))).status).toBe(200)
    expect(await memoryState(service, memoryId)).toEqual({ status: 'live', hidden_reason: null })
  })

  test('restoring a moment that is already up changes nothing and says so', async () => {
    // The console holds a snapshot that is routinely minutes old, so this is
    // the ordinary double-click, not an edge case. Without the early return it
    // would fall through to the gate and answer a live moment with "nothing
    // here records who took this down".
    const memoryId = await seed()

    expect((await adminAction(admin(memoryId, 'unhide'))).status).toBe(200)

    expect(await memoryState(service, memoryId)).toEqual({ status: 'live', hidden_reason: null })
  })

  test('a row that is off the wall for any other reason is not a silent no-op', async () => {
    // 'flagged' is the v2 auto-filter's state and nothing writes it yet, but
    // `memories_read_live` keeps it off the wall all the same. Answering
    // "restored" while leaving it down would be a false success in the
    // function's contract — the kind that surfaces later as a button that
    // quietly does nothing.
    const memoryId = await seed()
    await service.from('memories').update({ status: 'flagged' }).eq('id', memoryId)

    const refused = await adminAction(admin(memoryId, 'unhide'))
    expect(refused.status).toBe(409)
    expect((await refused.json()).reason).toBe('unknown')

    expect((await adminAction(admin(memoryId, 'unhide', 'unknown'))).status).toBe(200)
    expect(await memoryState(service, memoryId)).toEqual({ status: 'live', hidden_reason: null })
  })

  test('hiding a moment that is already gone says so too', async () => {
    // the sibling of the unhide case below: a stale snapshot clicked either way
    // gets the same honest answer
    expect((await adminAction(admin(randomUUID(), 'hide'))).status).toBe(404)
  })

  test('restoring a moment that is already gone says so', async () => {
    const res = await adminAction(admin(randomUUID(), 'unhide'))
    expect(res.status).toBe(404)
  })
})

describe('what a restore adjudicates — and what it does not', () => {
  test('restoring a report hide clears the reports, so one re-report cannot re-hide it', async () => {
    const memoryId = await seed()
    await reportThreeTimes(memoryId)

    expect((await adminAction(admin(memoryId, 'unhide'))).status).toBe(200)

    // the 3-strike counter is those rows (docs/09 A-2): leaving them means the
    // very next report puts it back down, and a griefer loops it forever
    expect(await reportCount(memoryId)).toBe(0)
  })

  test('overruling an author’s takedown leaves the reports alone', async () => {
    const owner = await newPassport('reason-keep-reports')
    const memoryId = await seed({ author_id: owner.userId })
    // two reports land while it is up — below the threshold, so it stays live —
    // then the author takes it down themselves, then a third arrives. Three
    // distinct reporters on a moment labelled 'owner', and nobody has looked
    // at any of them.
    await reportOnce(memoryId, 'a')
    await reportOnce(memoryId, 'b')
    await removeOwn(removeRequest(memoryId, owner.token))
    await reportOnce(memoryId, 'c')
    expect((await memoryState(service, memoryId)).hidden_reason).toBe('owner')

    expect((await adminAction(admin(memoryId, 'unhide', 'owner'))).status).toBe(200)

    // the operator reviewed nothing about them. Wiping them here would erase
    // the repeat-infringer trail (docs/09 D) and hand out a clean slate as a
    // side effect of overruling the author — two things nobody asked for.
    expect(await reportCount(memoryId)).toBe(3)
  })
})

describe('a label only stands on the proof it names', () => {
  // A NULL credential is not "no credential given" — it makes its own predicate
  // vacuously true. Tying each label to its proof inside the channel is what
  // keeps that from being a per-caller thing to remember, which is exactly what
  // the caller in front of it forgot.
  test.each([
    ['token', { p_reason: 'token' }],
    ['owner', { p_reason: 'owner' }],
  ])('%s cannot be claimed without one', async (_label, args) => {
    const memoryId = await seed()

    const { error } = await service.rpc('hide_memory', { p_memory_id: memoryId, ...args })

    expect(error?.code).toBe('22023')
    expect(await memoryState(service, memoryId)).toEqual({ status: 'live', hidden_reason: null })
  })

  test('anon cannot take a moment down through the one RPC it is allowed to call', async () => {
    const memoryId = await seed()

    // The whole public attack surface: an id anyone can read off the wall, the
    // anon key that ships in the browser bundle, and no token at all.
    const { data, error } = await anon.rpc('takedown_memory', {
      p_memory_id: memoryId,
      p_token: null,
    })

    expect(error).toBeNull()
    expect(data).toBe(false)
    expect(await memoryState(service, memoryId)).toEqual({ status: 'live', hidden_reason: null })
  })
})

describe('grants', () => {
  test('anon cannot reach the channel that writes labels, or the one that restores', async () => {
    const memoryId = await seed()

    const hide = await anon.rpc('hide_memory', { p_memory_id: memoryId, p_reason: 'operator' })
    expect(hide.error?.code).toBe('42501')

    const restore = await anon.rpc('restore_memory', { p_memory_id: memoryId })
    expect(restore.error?.code).toBe('42501')

    // takedown_memory stays anon-callable on purpose — it is the one hiding
    // path a link holder has, and it cannot name its own label
    expect((await memoryState(service, memoryId)).status).toBe('live')
  })
})
