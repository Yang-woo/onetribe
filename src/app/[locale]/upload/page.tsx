import type { Metadata } from 'next'
import { UploadWizard } from '@/components/upload-wizard'
import { fetchEditions } from '@/lib/moments'
import { localeAlternates } from '@/lib/seo'
import { supabaseServerAnon } from '@/lib/supabase/server-anon'

export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  return { alternates: localeAlternates('/upload') }
}

// The h1 lives inside the wizard header row now (redesign §3): it swaps copy
// between step 1 and step 2, so the page just hosts the container.
export default async function UploadPage() {
  const editions = await fetchEditions(supabaseServerAnon())
  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-10">
      <UploadWizard editions={editions} />
    </main>
  )
}
