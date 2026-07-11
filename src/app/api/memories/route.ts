import { createServiceRoleClient } from '@/lib/server/supabase'
import { verifyTurnstile } from '@/lib/server/turnstile'
import { uploadSessionSecret } from '@/lib/server/upload-session'
import { createStorage } from '@/lib/storage'
import { createMemoriesHandler } from '@/server/upload'

export async function POST(req: Request): Promise<Response> {
  return createMemoriesHandler({
    storage: createStorage(),
    verifyTurnstile,
    db: createServiceRoleClient(),
    sessionSecret: uploadSessionSecret(),
  })(req)
}
