import { revalidateTag } from 'next/cache'
import { createServiceRoleClient } from '@/lib/server/supabase'
import { createStorage } from '@/lib/storage'
import { adminEmailsFromEnv, createAdminActionHandler } from '@/server/admin'

export async function POST(req: Request): Promise<Response> {
  return createAdminActionHandler({
    db: createServiceRoleClient(),
    adminEmails: adminEmailsFromEnv(),
    storage: createStorage(),
    // expire:0 so the next wall render reflects a takedown immediately —
    // 'max' would serve the pre-moderation count once more (docs/00 D12).
    revalidate: (tag) => revalidateTag(tag, { expire: 0 }),
  })(req)
}
