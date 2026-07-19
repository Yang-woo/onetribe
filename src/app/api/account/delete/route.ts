import { createServiceRoleClient } from '@/lib/server/supabase'
import { createAccountDeleteHandler } from '@/server/account'

export async function POST(req: Request): Promise<Response> {
  return createAccountDeleteHandler({ db: createServiceRoleClient() })(req)
}
