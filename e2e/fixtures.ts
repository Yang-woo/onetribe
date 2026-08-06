import { readFileSync } from 'node:fs'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Shared e2e fixtures. Row-shaped helpers are re-exported from the DB suite's
 * `tests/db/helpers.ts` rather than copied — they take the client as an
 * argument and touch no environment, so a schema or seed change has exactly
 * one place to land. Only the CLIENT differs between the suites and so lives
 * here: that one reads keys `supabase status` exported into the environment,
 * while Playwright inherits nothing and has to go to `.env.local` itself.
 */
export { eventIdByYear, seedMemory } from '../tests/db/helpers'

/** The local stack's keys, straight out of `.env.local`. */
function localEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    // Keys carry digits (R2_ACCOUNT_ID …), and a CRLF checkout leaves a \r
    // that `.` would otherwise swallow into the value.
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (match) env[match[1]] = match[2].trim()
  }
  return env
}

/**
 * Service-role client — seeding and cleanup only, never RLS assertions (it
 * bypasses them). The key has no NEXT_PUBLIC_ prefix and must stay out of the
 * browser bundle; a spec is Node-side, so this is the one safe place for it.
 */
export function serviceClient(): SupabaseClient {
  const env = localEnv()
  const url = env.NEXT_PUBLIC_SUPABASE_URL
  const key = env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be in .env.local')
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}
