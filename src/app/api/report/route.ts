import { createServiceRoleClient } from '@/lib/server/supabase'
import { createReportHandler } from '@/server/upload'

export async function POST(req: Request): Promise<Response> {
  return createReportHandler({ db: createServiceRoleClient() })(req)
}
