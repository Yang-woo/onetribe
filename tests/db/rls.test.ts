import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { PUBLIC_MEMORY_COLUMNS } from '@/lib/moments'
import { createAnonClient, createServiceClient, eventIdByYear } from './helpers'

/**
 * RLS matrix tests — docs/17 T1.2, matrix in docs/02 + D9 P1.
 * Every assertion runs through the anon-key client; the service client
 * only builds fixtures. Testing RLS via service role would be meaningless.
 */

// PUBLIC_MEMORY_COLUMNS comes from src/lib/moments — one list is the SSOT
// for what anon may read; takedown_token is deliberately NOT on it.

const service = createServiceClient()
const anon = createAnonClient()

let eventId: string
let liveId: string
let hiddenId: string
const createdUserIds: string[] = []

beforeAll(async () => {
  eventId = await eventIdByYear(service, 2019)

  const { data: rows, error: insertError } = await service
    .from('memories')
    .insert([
      {
        event_id: eventId,
        media_kind: 'image',
        media_url: 'https://example.com/rls-live.jpg',
        caption: 'rls-test-live',
        rights_confirmed: true,
        status: 'live',
      },
      {
        event_id: eventId,
        media_kind: 'image',
        media_url: 'https://example.com/rls-hidden.jpg',
        caption: 'rls-test-hidden',
        rights_confirmed: true,
        status: 'hidden',
      },
    ])
    .select('id, status')
  if (insertError || !rows) throw new Error(`fixture insert failed: ${insertError?.message}`)
  liveId = rows.find((r) => r.status === 'live')!.id
  hiddenId = rows.find((r) => r.status === 'hidden')!.id
})

afterAll(async () => {
  await service.from('memories').delete().in('id', [liveId, hiddenId])
  for (const id of createdUserIds) {
    await service.auth.admin.deleteUser(id)
  }
})

describe('memories — read', () => {
  test('anon sees live rows only; hidden is invisible in lists', async () => {
    const { data, error } = await anon.from('memories').select(PUBLIC_MEMORY_COLUMNS)
    expect(error).toBeNull()
    const ids = (data ?? []).map((r) => r.id)
    expect(ids).toContain(liveId)
    expect(ids).not.toContain(hiddenId)
  })

  test('anon cannot fetch a hidden row by id', async () => {
    const { data, error } = await anon
      .from('memories')
      .select(PUBLIC_MEMORY_COLUMNS)
      .eq('id', hiddenId)
      .maybeSingle()
    expect(error).toBeNull()
    expect(data).toBeNull()
  })

  test('anon cannot read takedown_token (column privilege)', async () => {
    const { error } = await anon.from('memories').select('id, takedown_token').eq('id', liveId)
    expect(error).not.toBeNull()
  })
})

describe('memories — write is server-only (D9 P1)', () => {
  test('anon insert is rejected', async () => {
    const { error } = await anon.from('memories').insert({
      event_id: eventId,
      media_kind: 'image',
      media_url: 'https://example.com/spam.jpg',
      rights_confirmed: true,
      status: 'live',
    })
    expect(error).not.toBeNull()
  })

  test('anon cannot hide or delete a live memory', async () => {
    const { error: updateError } = await anon
      .from('memories')
      .update({ status: 'hidden' })
      .eq('id', liveId)
    expect(updateError).not.toBeNull()

    const { error: deleteError } = await anon.from('memories').delete().eq('id', liveId)
    expect(deleteError).not.toBeNull()

    const { data } = await service.from('memories').select('status').eq('id', liveId).single()
    expect(data?.status).toBe('live')
  })
})

describe('reports — no direct client access (server route only)', () => {
  // A client-supplied reporter_hint could forge 3 "distinct reporters" and
  // auto-hide any memory, so reports also write through the server route
  // (migration 20260712000500).
  test('anon cannot insert reports directly', async () => {
    const { error } = await anon.from('reports').insert({
      memory_id: liveId,
      reason: 'spam',
      reporter_hint: 'forged-hint',
    })
    expect(error).not.toBeNull()
  })

  test('anon cannot read reports', async () => {
    const { error } = await anon.from('reports').select('id, memory_id, reason')
    expect(error).not.toBeNull()
  })
})

describe('events & translations — public read, no writes', () => {
  test('anon reads events', async () => {
    const { data, error } = await anon.from('events').select('id').limit(1)
    expect(error).toBeNull()
    expect(data?.length).toBe(1)
  })

  test('anon cannot write events', async () => {
    const { error } = await anon
      .from('events')
      .insert({ festival: 'Fake Fest', year: 2099, city: 'Nowhere', country: 'XX' })
    expect(error).not.toBeNull()
  })

  test('anon reads translations but cannot write them', async () => {
    const { error: readError } = await anon.from('translations').select('source_hash').limit(1)
    expect(readError).toBeNull()

    const { error: writeError } = await anon
      .from('translations')
      .insert({ source_hash: 'x'.repeat(64), target_lang: 'ko', text: 'nope' })
    expect(writeError).not.toBeNull()
  })
})

describe('profiles & attendance — own rows only (anonymous auth)', () => {
  test('unauthenticated client cannot create a profile', async () => {
    const { error } = await anon
      .from('profiles')
      .insert({ id: randomUUID(), display_name: 'ghost' })
    expect(error).not.toBeNull()
  })

  test('an anonymous-auth user manages only their own profile and attendance', async () => {
    const userA = createAnonClient()
    const userB = createAnonClient()
    const { data: authA, error: authErrorA } = await userA.auth.signInAnonymously()
    const { data: authB, error: authErrorB } = await userB.auth.signInAnonymously()
    expect(authErrorA).toBeNull()
    expect(authErrorB).toBeNull()
    const uidA = authA.user!.id
    const uidB = authB.user!.id
    createdUserIds.push(uidA, uidB)

    // A creates and updates own profile
    const { error: insertOwn } = await userA
      .from('profiles')
      .insert({ id: uidA, display_name: 'tester-a' })
    expect(insertOwn).toBeNull()
    const { data: updated, error: updateOwn } = await userA
      .from('profiles')
      .update({ display_name: 'tester-a2' })
      .eq('id', uidA)
      .select('display_name')
    expect(updateOwn).toBeNull()
    expect(updated?.[0]?.display_name).toBe('tester-a2')

    // B cannot see or modify A's profile
    const { data: peek } = await userB.from('profiles').select('id').eq('id', uidA)
    expect(peek ?? []).toHaveLength(0)
    const { data: hijack } = await userB
      .from('profiles')
      .update({ display_name: 'hax' })
      .eq('id', uidA)
      .select('id')
    expect(hijack ?? []).toHaveLength(0)

    // attendance: A checks an edition; B cannot write rows for A
    const { error: attendOwn } = await userA
      .from('attendance')
      .insert({ profile_id: uidA, event_id: eventId })
    expect(attendOwn).toBeNull()
    const { error: attendForge } = await userB
      .from('attendance')
      .insert({ profile_id: uidA, event_id: eventId })
    expect(attendForge).not.toBeNull()
    const { data: peekAttendance } = await userB
      .from('attendance')
      .select('event_id')
      .eq('profile_id', uidA)
    expect(peekAttendance ?? []).toHaveLength(0)

    // uidB never made a profile row — their reads return empty, not errors
    const { data: ownEmpty, error: ownEmptyError } = await userB.from('profiles').select('id')
    expect(ownEmptyError).toBeNull()
    expect(ownEmpty ?? []).toHaveLength(0)
  })
})
