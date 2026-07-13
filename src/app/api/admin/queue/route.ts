import { createServiceRoleClient } from '@/lib/server/supabase'
import { adminEmailsFromEnv, createAdminQueueHandler } from '@/server/admin'

export async function GET(req: Request): Promise<Response> {
  return createAdminQueueHandler({
    db: createServiceRoleClient(),
    adminEmails: adminEmailsFromEnv(),
  })(req)
}
