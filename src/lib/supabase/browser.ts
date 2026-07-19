'use client'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let client: SupabaseClient | undefined

/** Browser anon client — all client reads pass RLS (live rows only). */
export function supabaseBrowser(): SupabaseClient {
  // PKCE so OAuth linking (passport → Google, D16) completes entirely in the
  // browser: detectSessionInUrl exchanges the ?code= on return, no server
  // callback route. Sessions stay device-local (localStorage) by design.
  client ??= createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { flowType: 'pkce' } },
  )
  return client
}
