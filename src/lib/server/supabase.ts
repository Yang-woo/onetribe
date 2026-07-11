import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Service-role client — SERVER ONLY, bypasses RLS. All content writes go
 * through routes using this client (docs/00 D9 P1); the validation in
 * those routes is the security boundary. Never import from client code:
 * the key has no NEXT_PUBLIC_ prefix, so bundling it client-side fails.
 */
export function createServiceRoleClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}
