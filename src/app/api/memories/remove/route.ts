import { revalidateTag } from 'next/cache'
import { createServiceRoleClient } from '@/lib/server/supabase'
import { createMomentRemoveHandler } from '@/server/moments'

export async function POST(req: Request): Promise<Response> {
  return createMomentRemoveHandler({
    db: createServiceRoleClient(),
    // `{ expire: 0 }` for the same reason the publish path uses it: the person
    // who just removed a moment is the most likely next reader of the counter.
    revalidate: (tag) => revalidateTag(tag, { expire: 0 }),
  })(req)
}
