import { revalidateTag } from 'next/cache'
import { createServiceRoleClient } from '@/lib/server/supabase'
import { createReportHandler } from '@/server/upload'

export async function POST(req: Request): Promise<Response> {
  return createReportHandler({
    db: createServiceRoleClient(),
    // expire:0 so the next wall render reflects an auto-hide immediately, like
    // the publish/admin/takedown sites (docs/00 D41).
    revalidate: (tag) => revalidateTag(tag, { expire: 0 }),
  })(req)
}
