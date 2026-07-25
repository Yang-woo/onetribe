import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createAccountDeleteHandler } from '@/server/account'
import { createAnonClient, createServiceClient, eventIdByYear, seedMemory } from './helpers'

/**
 * /api/account/delete — D16 GDPR self-serve erasure. The bearer token is
 * the entire gate (you can only delete yourself). Wall moments survive
 * but are anonymized: author_name/author_link cleared, author_id nulls
 * via FK when the auth user (and its cascading profile) goes.
 */

const service = createServiceClient()
const ADMIN_EMAIL = `operator-${randomUUID().slice(0, 8)}@onetribe.world`
const handler = createAccountDeleteHandler({ db: service, adminEmails: [ADMIN_EMAIL] })

let eventId: string
const fixtureIds: string[] = []
const userIds: string[] = []

function deleteRequest(token?: string): Request {
  return new Request('http://localhost/api/account/delete', {
    method: 'POST',
    headers: token ? { authorization: `Bearer ${token}` } : {},
  })
}

beforeAll(async () => {
  eventId = await eventIdByYear(service, 2018)
})

afterAll(async () => {
  await service.from('memories').delete().in('id', fixtureIds)
  for (const id of userIds) {
    await service.auth.admin.deleteUser(id).catch(() => {})
  }
})

describe('account delete route', () => {
  test('no token → 401', async () => {
    const res = await handler(deleteRequest())
    expect(res.status).toBe(401)
  })

  test('garbage token → 401', async () => {
    const res = await handler(deleteRequest('not-a-jwt'))
    expect(res.status).toBe(401)
  })

  test('an ADMIN_EMAILS account is refused (403) and survives', async () => {
    const password = `guard-${randomUUID()}`
    const { data, error } = await service.auth.admin.createUser({
      email: ADMIN_EMAIL,
      password,
      email_confirm: true,
    })
    if (error || !data.user) throw new Error(`operator fixture: ${error?.message}`)
    userIds.push(data.user.id)
    // an operator-authored moment — a refused delete must not touch it either
    // (author_id FK needs the profile row, same as the app's upload path)
    await service.from('profiles').upsert({ id: data.user.id, display_name: 'operator' })
    const opMemoryId = await seedMemory(service, {
      event_id: eventId,
      caption: `operator-${randomUUID().slice(0, 8)}`,
      author_id: data.user.id,
      author_name: 'operator',
      author_link: 'https://instagram.com/operator',
    })
    fixtureIds.push(opMemoryId)
    const client = createAnonClient()
    const { data: auth } = await client.auth.signInWithPassword({ email: ADMIN_EMAIL, password })

    const res = await handler(deleteRequest(auth.session!.access_token))
    expect(res.status).toBe(403)

    // the account must still exist — the whole point of the guard
    const { data: alive } = await service.auth.admin.getUserById(data.user.id)
    expect(alive.user?.email).toBe(ADMIN_EMAIL)
    // and the refusal ran zero side effects — author credit untouched
    const { data: moment } = await service
      .from('memories')
      .select('author_name, author_link')
      .eq('id', opMemoryId)
      .single()
    expect(moment?.author_name).toBe('operator')
    expect(moment?.author_link).toBe('https://instagram.com/operator')
  })

  test('a signed-in user deletes themselves: cascade + anonymized moments', async () => {
    const client = createAnonClient()
    const { data: auth } = await client.auth.signInAnonymously()
    const uid = auth.user!.id
    userIds.push(uid)
    const token = auth.session!.access_token

    await client.from('profiles').upsert({ id: uid, display_name: 'doomed' })
    await client.from('attendance').upsert({ profile_id: uid, event_id: eventId })
    const caption = `account-delete-${randomUUID().slice(0, 8)}`
    const memoryId = await seedMemory(service, {
      event_id: eventId,
      caption,
      author_id: uid,
      author_name: 'doomed',
      author_link: 'https://instagram.com/doomed',
    })
    fixtureIds.push(memoryId)
    // a bystander's moment — anonymization must scope to the deleted user only
    const bystanderId = await seedMemory(service, {
      event_id: eventId,
      caption: `bystander-${randomUUID().slice(0, 8)}`,
      author_name: 'innocent',
      author_link: 'https://instagram.com/innocent',
    })
    fixtureIds.push(bystanderId)

    const res = await handler(deleteRequest(token))
    expect(res.status).toBe(200)

    // auth user + owned rows are gone
    const { data: ghost } = await service.auth.admin.getUserById(uid)
    expect(ghost.user).toBeNull()
    const { data: profiles } = await service.from('profiles').select('id').eq('id', uid)
    expect(profiles).toHaveLength(0)
    const { data: stamps } = await service
      .from('attendance')
      .select('event_id')
      .eq('profile_id', uid)
    expect(stamps).toHaveLength(0)

    // the moment stays on the wall, fully anonymized
    const { data: moment } = await service
      .from('memories')
      .select('status, author_id, author_name, author_link')
      .eq('id', memoryId)
      .single()
    expect(moment?.status).toBe('live')
    expect(moment?.author_id).toBeNull()
    expect(moment?.author_name).toBeNull()
    expect(moment?.author_link).toBeNull()

    // and nobody else's credit was touched (a scope bug here would wipe the wall)
    const { data: bystander } = await service
      .from('memories')
      .select('author_name, author_link')
      .eq('id', bystanderId)
      .single()
    expect(bystander?.author_name).toBe('innocent')
    expect(bystander?.author_link).toBe('https://instagram.com/innocent')
  })
})
