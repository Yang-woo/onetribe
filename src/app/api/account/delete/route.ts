import { revalidateTag } from 'next/cache'
import { createServiceRoleClient } from '@/lib/server/supabase'
import { createAccountDeleteHandler } from '@/server/account'
import { adminEmailsFromEnv } from '@/server/admin'

export async function POST(req: Request): Promise<Response> {
  return createAccountDeleteHandler({
    db: createServiceRoleClient(),
    adminEmails: adminEmailsFromEnv(),
    // `{ expire: 0 }`: an erased name must not be served once more while the
    // page re-renders in the background.
    revalidate: (tag) => revalidateTag(tag, { expire: 0 }),
  })(req)
}
