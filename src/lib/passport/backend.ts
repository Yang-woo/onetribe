'use client'

import type { SupabaseClient, User } from '@supabase/supabase-js'
import { PUBLIC_MEMORY_COLUMNS, type Moment } from '@/lib/moments'
import { supabaseBrowser } from '@/lib/supabase/browser'

/**
 * Passport data access — docs/15 §4. Anonymous Supabase auth: the session
 * lives in this browser only (a device-local pass, no email required).
 * D16 adds an optional upgrade — link an email (6-digit OTP) or Google so
 * the same passport opens on any device. Upgrading keeps the user id, so
 * profiles/attendance/memories rows carry over untouched.
 * RLS scopes every read/write to the owner (tests/db/rls).
 */

export interface PassportIdentity {
  /** Linked email, null while anonymous. */
  email: string | null
  /** Linked OAuth providers (e.g. ['google']) — 'email' is not listed here. */
  providers: string[]
  isAnonymous: boolean
}

export interface PassportState {
  userId: string
  displayName: string | null
  attendedEventIds: string[]
  moments: Moment[]
  identity: PassportIdentity
}

/** UI-facing buckets for auth failures — mapped from GoTrue error codes. */
export type PassportAuthErrorCode =
  | 'email-in-use'
  | 'no-passport'
  | 'bad-code'
  | 'rate-limited'
  | 'unknown'

const AUTH_ERROR_CODES: Record<string, PassportAuthErrorCode> = {
  email_exists: 'email-in-use',
  identity_already_exists: 'email-in-use',
  // signInWithOtp({ shouldCreateUser: false }) rejects unknown emails with this
  otp_disabled: 'no-passport',
  otp_expired: 'bad-code',
  over_email_send_rate_limit: 'rate-limited',
  over_request_rate_limit: 'rate-limited',
}

export function passportAuthErrorCode(error: unknown): PassportAuthErrorCode {
  if (error && typeof error === 'object' && 'code' in error) {
    const mapped = AUTH_ERROR_CODES[String((error as { code?: unknown }).code)]
    if (mapped) return mapped
  }
  return 'unknown'
}

export interface PassportBackend {
  load(): Promise<PassportState | null>
  start(displayName: string): Promise<PassportState>
  setAttendance(eventId: string, attended: boolean): Promise<void>
  // ── upgrade: keeps the current user id, data carries over ──
  linkEmailStart(email: string): Promise<void>
  linkEmailVerify(email: string, code: string): Promise<void>
  linkGoogle(redirectTo: string): Promise<void>
  // ── sign in on another device: replaces the local session ──
  signInEmailStart(email: string): Promise<void>
  signInEmailVerify(email: string, code: string): Promise<PassportState>
  signInGoogle(redirectTo: string): Promise<void>
  // ── account ──
  signOut(): Promise<void>
  deleteAccount(): Promise<void>
}

function identityOf(user: User): PassportIdentity {
  return {
    email: user.email ?? null,
    providers: (user.identities ?? [])
      .map((identity) => identity.provider)
      .filter((provider) => provider !== 'email'),
    isAnonymous: user.is_anonymous ?? false,
  }
}

async function stateFor(client: SupabaseClient, user: User): Promise<PassportState> {
  const userId = user.id
  const [{ data: profile }, { data: attendance }, { data: moments }] = await Promise.all([
    client.from('profiles').select('display_name').eq('id', userId).maybeSingle(),
    client.from('attendance').select('event_id').eq('profile_id', userId),
    client
      .from('memories')
      .select(PUBLIC_MEMORY_COLUMNS)
      .eq('author_id', userId)
      .order('created_at', { ascending: false }),
  ])
  return {
    userId,
    displayName: profile?.display_name ?? null,
    attendedEventIds: (attendance ?? []).map((row) => row.event_id),
    moments: (moments ?? []) as unknown as Moment[],
    identity: identityOf(user),
  }
}

export function createSupabasePassportBackend(
  client: SupabaseClient = supabaseBrowser(),
): PassportBackend {
  async function currentUser(): Promise<User | null> {
    // getSession awaits the client's initialize step, which also completes a
    // pending PKCE ?code= exchange after an OAuth return — no load race.
    const { data } = await client.auth.getSession()
    return data.session?.user ?? null
  }

  return {
    async load() {
      const user = await currentUser()
      if (!user) return null
      return stateFor(client, user)
    },

    async start(displayName) {
      const { data, error } = await client.auth.signInAnonymously()
      if (error || !data.user) throw new Error(`anonymous sign-in failed: ${error?.message}`)
      const { error: profileError } = await client
        .from('profiles')
        .upsert({ id: data.user.id, display_name: displayName.trim() || null })
      if (profileError) throw new Error(`profile create failed: ${profileError.message}`)
      return stateFor(client, data.user)
    },

    async setAttendance(eventId, attended) {
      const user = await currentUser()
      if (!user) throw new Error('no passport session')
      if (attended) {
        const { error } = await client
          .from('attendance')
          .upsert({ profile_id: user.id, event_id: eventId })
        if (error) throw new Error(error.message)
      } else {
        const { error } = await client
          .from('attendance')
          .delete()
          .eq('profile_id', user.id)
          .eq('event_id', eventId)
        if (error) throw new Error(error.message)
      }
    },

    async linkEmailStart(email) {
      // On an anonymous user this starts the email_change flow: one OTP to the
      // new address (no old address exists, so double-confirm sends nothing else).
      const { error } = await client.auth.updateUser({ email })
      if (error) throw error
    },

    async linkEmailVerify(email, code) {
      const { error } = await client.auth.verifyOtp({ email, token: code, type: 'email_change' })
      if (error) throw error
    },

    async linkGoogle(redirectTo) {
      // Navigates away; requires "manual linking" enabled on the project.
      const { error } = await client.auth.linkIdentity({
        provider: 'google',
        options: { redirectTo },
      })
      if (error) throw error
    },

    async signInEmailStart(email) {
      // shouldCreateUser:false — signing in must never mint an empty passport.
      const { error } = await client.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: false },
      })
      if (error) throw error
    },

    async signInEmailVerify(email, code) {
      const { data, error } = await client.auth.verifyOtp({ email, token: code, type: 'email' })
      if (error) throw error
      if (!data.user) throw new Error('sign-in returned no user')
      return stateFor(client, data.user)
    },

    async signInGoogle(redirectTo) {
      const { error } = await client.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo },
      })
      if (error) throw error
    },

    async signOut() {
      // scope:'local' — leaving this device must not revoke the passport's
      // sessions on other devices (the default scope is global).
      const { error } = await client.auth.signOut({ scope: 'local' })
      if (error) throw new Error(error.message)
    },

    async deleteAccount() {
      const { data } = await client.auth.getSession()
      const token = data.session?.access_token
      if (!token) throw new Error('no passport session')
      const res = await fetch('/api/account/delete', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error(`account delete failed (${res.status})`)
      // The server-side user is gone; drop the now-dead local session too.
      await client.auth.signOut({ scope: 'local' })
    },
  }
}
