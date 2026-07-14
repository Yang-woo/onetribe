import { createServiceRoleClient } from '@/lib/server/supabase'
import { createStorage } from '@/lib/storage'
import { adminEmailsFromEnv, createAdminActionHandler } from '@/server/admin'

export async function POST(req: Request): Promise<Response> {
  return createAdminActionHandler({
    db: createServiceRoleClient(),
    adminEmails: adminEmailsFromEnv(),
    storage: createStorage(),
  })(req)
}
