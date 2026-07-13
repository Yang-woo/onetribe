import { createServiceRoleClient } from '@/lib/server/supabase'
import { adminEmailsFromEnv, createAdminActionHandler } from '@/server/admin'

export async function POST(req: Request): Promise<Response> {
  return createAdminActionHandler({
    db: createServiceRoleClient(),
    adminEmails: adminEmailsFromEnv(),
  })(req)
}
