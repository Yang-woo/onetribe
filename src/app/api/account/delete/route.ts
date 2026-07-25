import { createServiceRoleClient } from '@/lib/server/supabase'
import { createAccountDeleteHandler } from '@/server/account'
import { adminEmailsFromEnv } from '@/server/admin'

export async function POST(req: Request): Promise<Response> {
  return createAccountDeleteHandler({
    db: createServiceRoleClient(),
    adminEmails: adminEmailsFromEnv(),
  })(req)
}
