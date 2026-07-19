import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, test } from 'vitest'
import { createAnonClient, createServiceClient, eventIdByYear } from './helpers'

/**
 * D16 — anonymous passport → email promotion, against the real local stack:
 * GoTrue sends a genuine 6-digit OTP (Mailpit captures it), verifyOtp
 * promotes in place. The product promise under test: the user id never
 * changes, so profiles/attendance survive, and owner-scoped RLS keeps
 * working identically before and after promotion.
 */

const service = createServiceClient()
const MAILPIT = 'http://127.0.0.1:54324' // supabase/config.toml [local_smtp]
const userIds: string[] = []

async function clearMailbox(): Promise<void> {
  await fetch(`${MAILPIT}/api/v1/messages`, { method: 'DELETE' })
}

/** Poll Mailpit for the newest mail to `address` and pull the 6-digit code. */
async function otpFor(address: string, timeoutMs = 20_000): Promise<string> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const list = (await (await fetch(`${MAILPIT}/api/v1/messages`)).json()) as {
      messages?: Array<{ ID: string; To?: Array<{ Address?: string }> }>
    }
    const mail = (list.messages ?? []).find((m) =>
      m.To?.some((to) => to.Address?.toLowerCase() === address.toLowerCase()),
    )
    if (mail) {
      const detail = (await (await fetch(`${MAILPIT}/api/v1/message/${mail.ID}`)).json()) as {
        Text?: string
        HTML?: string
      }
      const match = `${detail.Text ?? ''} ${detail.HTML ?? ''}`.match(/\b(\d{6})\b/)
      if (match) return match[1]
    }
    await new Promise((resolve) => setTimeout(resolve, 400))
  }
  throw new Error(
    `no OTP mail for ${address} within ${timeoutMs}ms — is local Supabase (Mailpit :54324) up?`,
  )
}

afterAll(async () => {
  for (const id of userIds) {
    await service.auth.admin.deleteUser(id).catch(() => {})
  }
})

describe('anonymous → email promotion (D16)', () => {
  test('full round trip: promote, keep uid + data + RLS, sign back in elsewhere', async () => {
    const email = `promo-${randomUUID().slice(0, 8)}@test.onetribe`
    const eventId = await eventIdByYear(service, 2018)

    // 1 — anonymous passport with a stamp, exactly like the product flow
    const client = createAnonClient()
    const { data: anonAuth, error: anonError } = await client.auth.signInAnonymously()
    expect(anonError).toBeNull()
    const uid = anonAuth.user!.id
    userIds.push(uid)
    expect(anonAuth.user!.is_anonymous).toBe(true)

    const { error: profileError } = await client
      .from('profiles')
      .upsert({ id: uid, display_name: 'promo warrior' })
    expect(profileError).toBeNull()
    const { error: stampError } = await client
      .from('attendance')
      .upsert({ profile_id: uid, event_id: eventId })
    expect(stampError).toBeNull()

    // 2 — link the email: real OTP out of Mailpit, verified as email_change
    await clearMailbox()
    const { error: linkError } = await client.auth.updateUser({ email })
    expect(linkError).toBeNull()
    const code = await otpFor(email)
    const { data: promoted, error: verifyError } = await client.auth.verifyOtp({
      email,
      token: code,
      type: 'email_change',
    })
    expect(verifyError).toBeNull()
    // the whole point: same user, no longer anonymous
    expect(promoted.user!.id).toBe(uid)
    expect(promoted.user!.is_anonymous).toBe(false)
    expect(promoted.user!.email).toBe(email)

    // 3 — owner-scoped RLS is untouched by promotion
    const { data: ownProfile } = await client
      .from('profiles')
      .update({ display_name: 'promoted warrior' })
      .eq('id', uid)
      .select('display_name')
    expect(ownProfile).toHaveLength(1)
    const { data: ownStamps } = await client.from('attendance').select('event_id')
    expect(ownStamps).toHaveLength(1)

    // 4 — another user still can't touch these rows
    const stranger = createAnonClient()
    const { data: strangerAuth } = await stranger.auth.signInAnonymously()
    userIds.push(strangerAuth.user!.id)
    const { data: peeked } = await stranger.from('profiles').select('id').eq('id', uid)
    expect(peeked).toHaveLength(0)
    const { data: vandalized } = await stranger
      .from('profiles')
      .update({ display_name: 'gotcha' })
      .eq('id', uid)
      .select('id')
    expect(vandalized).toHaveLength(0)
    const { error: forgedStamp } = await stranger
      .from('attendance')
      .insert({ profile_id: uid, event_id: eventId })
    expect(forgedStamp).not.toBeNull()

    // 5 — "another device": fresh client signs in with the same email via OTP
    await client.auth.signOut({ scope: 'local' })
    const otherDevice = createAnonClient()
    await clearMailbox()
    const { error: signInError } = await otherDevice.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
    })
    expect(signInError).toBeNull()
    const signInCode = await otpFor(email)
    const { data: back, error: backError } = await otherDevice.auth.verifyOtp({
      email,
      token: signInCode,
      type: 'email',
    })
    expect(backError).toBeNull()
    expect(back.user!.id).toBe(uid) // same passport
    const { data: carried } = await otherDevice
      .from('profiles')
      .select('display_name')
      .eq('id', uid)
      .single()
    expect(carried?.display_name).toBe('promoted warrior')
  }, 60_000)

  test('signing in with an unknown email never mints a passport', async () => {
    const client = createAnonClient()
    const { error } = await client.auth.signInWithOtp({
      email: `ghost-${randomUUID().slice(0, 8)}@test.onetribe`,
      options: { shouldCreateUser: false },
    })
    expect(error).not.toBeNull()
    expect((error as { code?: string }).code).toBe('otp_disabled')
  })
})
