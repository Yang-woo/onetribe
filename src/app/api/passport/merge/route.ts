import { createServiceRoleClient } from '@/lib/server/supabase'
import { createPassportMergeHandler } from '@/server/passport-merge'

export async function POST(req: Request): Promise<Response> {
  return createPassportMergeHandler({ db: createServiceRoleClient() })(req)
}
