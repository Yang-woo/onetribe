import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Server-side ANON client for reads — deliberately not the service role.
 * Public pages must see exactly what the public sees (RLS: live only),
 * so a rendering bug can never leak hidden rows or guarded columns.
 */
export function supabaseServerAnon(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set')
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}
