import { afterAll, describe, expect, test } from 'vitest'
import { createSupabasePassportBackend } from '@/lib/passport/backend'
import { createAnonClient, createServiceClient } from './helpers'

/**
 * backend.ensureSession — the upload attribution seam (docs/00 D43). An
 * upload-first visitor has no passport, so the wizard mints an anonymous one
 * and attributes the moment to it; a returning visitor reuses the session they
 * already have. Verified against real local Supabase with the anon key (D8):
 * the mint must produce a genuine anonymous auth user, and a second call must
 * NOT create a second one for the same browser.
 */

const service = createServiceClient()
const userIds: string[] = []

afterAll(async () => {
  for (const id of userIds) await service.auth.admin.deleteUser(id)
})

async function userIdForToken(token: string): Promise<string> {
  const { data, error } = await service.auth.getUser(token)
  if (error || !data.user) throw new Error(`token did not resolve to a user: ${error?.message}`)
  return data.user.id
}

describe('backend.ensureSession (upload attribution, D43)', () => {
  test('with no session, mints a genuine anonymous user and returns its token', async () => {
    const client = createAnonClient()
    const backend = createSupabasePassportBackend(client)

    // no start(), no prior upload — this browser has never authenticated
    expect((await client.auth.getSession()).data.session).toBeNull()

    const token = await backend.ensureSession()
    const uid = await userIdForToken(token)
    userIds.push(uid)

    // the minted user is a real anonymous auth user the upload can be attributed
    // to — its id is what lands in memories.author_id
    const { data } = await service.auth.admin.getUserById(uid)
    expect(data.user?.is_anonymous).toBe(true)
  })

  test('reuses the existing session instead of minting a second user', async () => {
    const client = createAnonClient()
    const backend = createSupabasePassportBackend(client)

    const first = await backend.ensureSession()
    const firstUid = await userIdForToken(first)
    userIds.push(firstUid)

    // a returning uploader (session already on the device) must resolve to the
    // SAME passport — minting again would scatter their moments across users
    const second = await backend.ensureSession()
    expect(await userIdForToken(second)).toBe(firstUid)
  })
})
