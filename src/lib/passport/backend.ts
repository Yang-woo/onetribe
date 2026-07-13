'use client'

import type { SupabaseClient } from '@supabase/supabase-js'
import { PUBLIC_MEMORY_COLUMNS, type Moment } from '@/lib/moments'
import { supabaseBrowser } from '@/lib/supabase/browser'

/**
 * Passport data access — docs/15 §4. Anonymous Supabase auth: the session
 * lives in this browser only (that IS the product: a device-local pass,
 * no email). RLS scopes every read/write to the owner (tests/db/rls).
 */

export interface PassportState {
  userId: string
  displayName: string | null
  attendedEventIds: string[]
  moments: Moment[]
}

export interface PassportBackend {
  load(): Promise<PassportState | null>
  start(displayName: string): Promise<PassportState>
  setAttendance(eventId: string, attended: boolean): Promise<void>
}

async function stateFor(client: SupabaseClient, userId: string): Promise<PassportState> {
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
  }
}

export function createSupabasePassportBackend(
  client: SupabaseClient = supabaseBrowser(),
): PassportBackend {
  return {
    async load() {
      const { data } = await client.auth.getSession()
      const userId = data.session?.user.id
      if (!userId) return null
      return stateFor(client, userId)
    },

    async start(displayName) {
      const { data, error } = await client.auth.signInAnonymously()
      if (error || !data.user) throw new Error(`anonymous sign-in failed: ${error?.message}`)
      const { error: profileError } = await client
        .from('profiles')
        .upsert({ id: data.user.id, display_name: displayName.trim() || null })
      if (profileError) throw new Error(`profile create failed: ${profileError.message}`)
      return stateFor(client, data.user.id)
    },

    async setAttendance(eventId, attended) {
      const { data } = await client.auth.getSession()
      const userId = data.session?.user.id
      if (!userId) throw new Error('no passport session')
      if (attended) {
        const { error } = await client
          .from('attendance')
          .upsert({ profile_id: userId, event_id: eventId })
        if (error) throw new Error(error.message)
      } else {
        const { error } = await client
          .from('attendance')
          .delete()
          .eq('profile_id', userId)
          .eq('event_id', eventId)
        if (error) throw new Error(error.message)
      }
    },
  }
}
