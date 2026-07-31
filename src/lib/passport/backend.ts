'use client'

import type { SupabaseClient, User } from '@supabase/supabase-js'
import { normalizeCountry } from '@/lib/country'
import { PUBLIC_MEMORY_COLUMNS, type Moment } from '@/lib/moments'
import { siteUrl } from '@/lib/site-url'
import { supabaseBrowser } from '@/lib/supabase/browser'

/**
 * Passport data access — docs/15 §4. Anonymous Supabase auth: the session
 * lives in this browser only (a device-local pass, no email required).
 * D16 adds an optional upgrade — link an email (6-digit OTP) so the same
 * passport opens on any device. Upgrading keeps the user id, so
 * profiles/attendance/memories rows carry over untouched. Signing in from a
 * device that already holds an anonymous passport folds it into the target
 * account (docs/00 D44), so an upload made there isn't left orphaned.
 * RLS scopes every read/write to the owner (tests/db/rls).
 */

export interface PassportIdentity {
  /** Linked email, null while anonymous. */
  email: string | null
  isAnonymous: boolean
}

export interface PassportState {
  userId: string
  displayName: string | null
  /** Bare Instagram handle (no "@"), reused to pre-fill uploads (docs/00 D30). */
  instagram: string | null
  /** ISO 3166-1 alpha-2 home country, reused to pre-fill uploads (docs/00 D31). */
  homeCountry: string | null
  attendedEventIds: string[]
  moments: Moment[]
  identity: PassportIdentity
}

/**
 * The reusable identity the upload form pre-fills from (docs/00 D30) — empty
 * strings (not null) so they seed input state directly. null = no session.
 */
export interface ProfileDefaults {
  displayName: string
  instagram: string
  /** ISO 3166-1 alpha-2 code, or '' — pre-fills the upload picker (docs/00 D31). */
  country: string
}

/**
 * Auth failure buckets — the values ARE the passport i18n message keys, so
 * every surface (OTP form, account panel, OAuth return) translates a GoTrue
 * code through this one map.
 */
export type PassportAuthErrorCode =
  'emailInUse' | 'noPassport' | 'badCode' | 'rateLimited' | 'genericError'

const AUTH_ERROR_CODES: Record<string, PassportAuthErrorCode> = {
  email_exists: 'emailInUse',
  // signInWithOtp({ shouldCreateUser: false }) rejects unknown emails with this
  otp_disabled: 'noPassport',
  otp_expired: 'badCode',
  over_email_send_rate_limit: 'rateLimited',
  over_request_rate_limit: 'rateLimited',
}

export function passportAuthErrorCode(error: unknown): PassportAuthErrorCode {
  if (error && typeof error === 'object' && 'code' in error) {
    const mapped = AUTH_ERROR_CODES[String((error as { code?: unknown }).code)]
    if (mapped) return mapped
  }
  return 'genericError'
}

export interface PassportBackend {
  load(): Promise<PassportState | null>
  start(displayName: string): Promise<PassportState>
  /** Returns an access token to attribute an upload to a passport, minting an
   *  anonymous one if this browser has none yet (docs/00 D43). So an
   *  upload-first visitor still owns their moment — it lands under a passport
   *  they can later add an email to — instead of unattributed. Throws only if
   *  the mint itself fails; callers treat that as "unattributed". */
  ensureSession(): Promise<string>
  /** Light read for pre-filling the upload form — null if no session (docs/00 D30). */
  loadProfileDefaults(): Promise<ProfileDefaults | null>
  /** Edit the reusable identity from the passport; returns the saved values (docs/00 D30, D31). */
  updateProfile(
    next: ProfileDefaults,
  ): Promise<{ displayName: string | null; instagram: string | null; homeCountry: string | null }>
  setAttendance(eventId: string, attended: boolean): Promise<void>
  // ── upgrade: keeps the current user id, data carries over ──
  linkEmailStart(email: string): Promise<void>
  linkEmailVerify(email: string, code: string): Promise<PassportIdentity>
  // ── sign in on another device: replaces the local session. If this browser
  //    already holds an anonymous passport, its uploads/stamps fold into the
  //    account being signed into (docs/00 D44). ──
  signInEmailStart(email: string): Promise<void>
  signInEmailVerify(email: string, code: string): Promise<PassportState>
  // ── account ──
  signOut(): Promise<void>
  deleteAccount(): Promise<void>
}

function identityOf(user: User): PassportIdentity {
  return {
    email: user.email ?? null,
    isAnonymous: user.is_anonymous ?? false,
  }
}

const MERGE_PATH = '/api/passport/merge'
/** Sign-in is blocked on the merge, so a stalled route must not pin the user on
 *  a dead confirm button — a hang is a failure like any other. */
const MERGE_TIMEOUT_MS = 5000

/** Relative in the browser, absolute under Node — a server-side caller with a
 *  relative URL doesn't fail loudly, it rejects on parse and lands in the same
 *  swallow below, i.e. skips the merge while looking like it ran. */
function mergeUrl(): string {
  return typeof window === 'undefined' ? new URL(MERGE_PATH, siteUrl()).toString() : MERGE_PATH
}

type MergeOutcome = 'ok' | 'refused' | 'error' | 'timeout'

async function attemptMerge(targetToken: string, anonToken: string): Promise<MergeOutcome> {
  try {
    const res = await fetch(mergeUrl(), {
      method: 'POST',
      headers: { authorization: `Bearer ${targetToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ anonToken }),
      signal: AbortSignal.timeout(MERGE_TIMEOUT_MS),
    })
    if (res.ok) return 'ok'
    // 4xx is a verdict on these two tokens (not anonymous, already spent,
    // over the ceiling) — asking again with the same pair can't change it.
    return res.status < 500 ? 'refused' : 'error'
  } catch (err) {
    return err instanceof Error && err.name === 'TimeoutError' ? 'timeout' : 'error'
  }
}

/**
 * Fold an anonymous passport (its uploads + stamps) into the account the user
 * just signed into (docs/00 D44). The server proves ownership of BOTH sides —
 * the target from this request's bearer, the anonymous source from its own
 * token — then reassigns and deletes the source.
 *
 * Never throws: the swallow lives HERE rather than at the call site, so a
 * second sign-in method can't forget it and turn a merge hiccup into a failed
 * sign-in — the exact thing the best-effort contract forbids. Retried once on a
 * transient fault, because by now verifyOtp has replaced the stored session and
 * the anonymous token exists nowhere but this stack frame: there is no later
 * attempt. Retrying is safe — the route is idempotent (docs/00 D45).
 */
async function mergeAnonInto(targetToken: string, anonToken: string): Promise<boolean> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const outcome = await attemptMerge(targetToken, anonToken)
    if (outcome === 'ok') return true
    // A verdict is final, and a timeout already spent the whole budget the
    // sign-in can afford to wait — only a fast fault is worth asking twice.
    if (outcome !== 'error') break
  }
  // The merge failed and cannot be retried later. The server alerts the
  // operator when the fault was its own (docs/00 D45); this covers the rest —
  // the request never landed, so nothing else anywhere knows it happened.
  console.warn('passport merge failed — this device’s passport was not folded in')
  return false
}

async function stateFor(client: SupabaseClient, user: User): Promise<PassportState> {
  const userId = user.id
  const [{ data: profile }, { data: attendance }, { data: moments }] = await Promise.all([
    client
      .from('profiles')
      .select('display_name, instagram, home_country')
      .eq('id', userId)
      .maybeSingle(),
    client.from('attendance').select('event_id').eq('profile_id', userId),
    client
      .from('memories')
      .select(PUBLIC_MEMORY_COLUMNS)
      .eq('author_id', userId)
      // (created_at, id) like the wall: a 5-photo batch shares one timestamp, so
      // created_at alone leaves the grid — and the modal's ←/→ order — arbitrary.
      .order('created_at', { ascending: false })
      .order('id', { ascending: false }),
  ])
  return {
    userId,
    displayName: profile?.display_name ?? null,
    instagram: profile?.instagram ?? null,
    homeCountry: profile?.home_country ?? null,
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

    async ensureSession() {
      // Reuse the device-local session if one exists (passport-first, or a
      // prior upload already minted one) — never mint a second anonymous user
      // for the same browser. getSession is local (no network), so this stays
      // cheap on the hot path.
      const {
        data: { session },
      } = await client.auth.getSession()
      if (session) return session.access_token
      const { data, error } = await client.auth.signInAnonymously()
      if (error || !data.session) throw new Error(`anonymous sign-in failed: ${error?.message}`)
      return data.session.access_token
    },

    async loadProfileDefaults() {
      const user = await currentUser()
      if (!user) return null
      const { data } = await client
        .from('profiles')
        .select('display_name, instagram, home_country')
        .eq('id', user.id)
        .maybeSingle()
      if (!data) return null
      return {
        displayName: data.display_name ?? '',
        instagram: data.instagram ?? '',
        country: data.home_country ?? '',
      }
    },

    async updateProfile({ displayName, instagram, country }) {
      const user = await currentUser()
      if (!user) throw new Error('no passport session')
      // Blank clears the stored value (null), so a user can remove a saved
      // name/handle/country from the passport, not just change it. The country
      // is validated to an ISO code (invalid → cleared) so home_country never
      // holds junk (docs/00 D31).
      const saved = {
        displayName: displayName.trim() || null,
        instagram: instagram.trim() || null,
        homeCountry: normalizeCountry(country),
      }
      // upsert (not update): an anonymous passport that only ever uploaded may
      // have no profile row yet if it skipped the "start" name step.
      const { error } = await client.from('profiles').upsert({
        id: user.id,
        display_name: saved.displayName,
        instagram: saved.instagram,
        home_country: saved.homeCountry,
      })
      if (error) throw new Error(error.message)
      return saved
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
      const { data, error } = await client.auth.verifyOtp({
        email,
        token: code,
        type: 'email_change',
      })
      if (error) throw error
      if (!data.user) throw new Error('email link returned no user')
      // only identity changes on a link — callers merge it instead of refetching
      return identityOf(data.user)
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
      // Capture the outgoing anonymous session BEFORE verifyOtp swaps it for the
      // target — its token is the proof we own it, and it's gone after the swap.
      const { data: before } = await client.auth.getSession()
      const prior = before.session
      const anonToken = prior?.user?.is_anonymous ? prior.access_token : undefined
      const priorId = prior?.user?.id

      const { data, error } = await client.auth.verifyOtp({ email, token: code, type: 'email' })
      if (error) throw error
      if (!data.user) throw new Error('sign-in returned no user')

      // Signed in from a device holding an anonymous passport → fold that
      // passport's uploads/stamps into the account, so a moment made here
      // isn't orphaned (docs/00 D44). Only when the target is a DIFFERENT
      // account, and best-effort: a merge failure must not undo the sign-in.
      const targetToken = data.session?.access_token
      if (anonToken && targetToken && data.user.id !== priorId) {
        await mergeAnonInto(targetToken, anonToken)
      }
      // Re-read AFTER the merge so the moved moments/stamps show up.
      return stateFor(client, data.user)
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
