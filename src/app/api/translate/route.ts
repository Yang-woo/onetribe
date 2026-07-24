import { createServiceRoleClient } from '@/lib/server/supabase'
import { supabaseServerAnon } from '@/lib/supabase/server-anon'
import { createDefaultProvider } from '@/lib/translate'
import { createTranslateHandler } from '@/server/translate'

export async function POST(req: Request): Promise<Response> {
  return createTranslateHandler({
    db: createServiceRoleClient(),
    anonDb: supabaseServerAnon(),
    provider: createDefaultProvider(),
  })(req)
}
