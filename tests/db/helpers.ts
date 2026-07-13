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

// ── shared fixtures (schema changes touch this file, not every suite) ────────

/** Seeded Defqon.1 NL edition id for a given year (docs/11 seed). */
export async function eventIdByYear(service: SupabaseClient, year: number): Promise<string> {
  const { data, error } = await service
    .from('events')
    .select('id')
    .eq('festival', 'Defqon.1')
    .eq('year', year)
    .single()
  if (error || !data) throw new Error(`events seed missing for ${year}: ${error?.message}`)
  return data.id
}

/** Minimal valid memory row; override any column. Returns the new id. */
export async function seedMemory(
  service: SupabaseClient,
  overrides: { event_id: string; caption?: string } & Record<string, unknown>,
): Promise<string> {
  const { data, error } = await service
    .from('memories')
    .insert({
      media_kind: 'image',
      media_url: `https://media.test/${overrides.caption ?? 'fixture'}.jpg`,
      rights_confirmed: true,
      status: 'live',
      ...overrides,
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`memory fixture failed: ${error?.message}`)
  return data.id
}

export async function memoryStatus(service: SupabaseClient, id: string): Promise<string> {
  const { data, error } = await service.from('memories').select('status').eq('id', id).single()
  if (error || !data) throw new Error(`memoryStatus(${id}): ${error?.message}`)
  return data.status
}
