import { revalidateTag } from 'next/cache'
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
    // `{ expire: 0 }`, not the recommended 'max': "max" marks the entry stale
    // and serves it once more while refreshing behind the scenes, so the
    // uploader's own first load after posting would still show the old count.
    // An external caller needing the next read to be true is exactly the case
    // the docs point at expire:0 for.
    revalidate: (tag) => revalidateTag(tag, { expire: 0 }),
  })(req)
}
