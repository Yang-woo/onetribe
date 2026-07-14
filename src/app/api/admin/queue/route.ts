import { createServiceRoleClient } from '@/lib/server/supabase'
import { createStorage } from '@/lib/storage'
import { adminEmailsFromEnv, createAdminQueueHandler } from '@/server/admin'

export async function GET(req: Request): Promise<Response> {
  return createAdminQueueHandler({
    db: createServiceRoleClient(),
    adminEmails: adminEmailsFromEnv(),
    storage: createStorage(),
  })(req)
}
