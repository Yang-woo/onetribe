/** Shared route-handler plumbing — one response envelope, one body parser. */

import type { SupabaseClient, User } from '@supabase/supabase-js'

export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

/**
 * The one Bearer gate — resolve the caller from the Authorization header or
 * hand back the 401 to return. Every authenticated route goes through this
 * so token parsing and the error envelope can never drift apart.
 */
export async function requireBearerUser(
  db: SupabaseClient,
  req: Request,
): Promise<{ user: User; denied?: undefined } | { user?: undefined; denied: Response }> {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return { denied: json(401, { error: 'sign in required' }) }
  const { data, error } = await db.auth.getUser(token)
  if (error || !data.user) return { denied: json(401, { error: 'sign in required' }) }
  return { user: data.user }
}

export async function parseBody(req: Request): Promise<unknown | null> {
  try {
    return await req.json()
  } catch {
    return null
  }
}
