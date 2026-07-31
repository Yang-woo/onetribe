'use client'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let client: SupabaseClient | undefined

/** Browser anon client — all client reads pass RLS (live rows only). */
export function supabaseBrowser(): SupabaseClient {
  // Sessions stay device-local (localStorage) by design — an anonymous
  // passport lives in this browser until an email is linked (D16). PKCE flow
  // for the email OTP exchange; no server callback route.
  client ??= createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { flowType: 'pkce' } },
  )
  return client
}
