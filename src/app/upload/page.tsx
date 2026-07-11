import { UploadWizard } from '@/components/upload-wizard'
import { copy } from '@/lib/copy'
import { fetchEditions } from '@/lib/moments'
import { supabaseServerAnon } from '@/lib/supabase/server-anon'

export const dynamic = 'force-dynamic'

export default async function UploadPage() {
  const editions = await fetchEditions(supabaseServerAnon())
  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-10">
      <h1 className="mb-8 font-display text-3xl lowercase tracking-tight">{copy.upload.title}</h1>
      <UploadWizard editions={editions} />
    </main>
  )
}
