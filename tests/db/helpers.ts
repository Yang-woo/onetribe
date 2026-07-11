import { createClient, type SupabaseClient } from '@supabase/supabase-js'

function env(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set — did global-setup run?`)
  return value
}

/**
 * Anonymous (public) client — the ONLY client RLS assertions may use.
 * Testing policies through the service role is meaningless: it bypasses RLS.
 */
export function createAnonClient(): SupabaseClient {
  return createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/** Service-role client — test fixtures/cleanup only. Never assert RLS with it. */
export function createServiceClient(): SupabaseClient {
  return createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
