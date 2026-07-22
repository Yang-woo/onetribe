import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { UploadWizard } from '@/components/upload-wizard'
import { isLocale } from '@/lib/locales'
import { getCachedEditions } from '@/lib/moments-cache'
import { localeAlternates } from '@/lib/seo'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  if (!isLocale(locale)) return {}
  const t = await getTranslations({ locale, namespace: 'upload' })
  return { title: t('title'), alternates: localeAlternates('/upload', locale) }
}

// The h1 lives inside the wizard header row now (redesign §3): it swaps copy
// between step 1 and step 2, so the page just hosts the container.
export default async function UploadPage() {
  const editions = await getCachedEditions()
  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-10">
      <UploadWizard editions={editions} />
    </main>
  )
}
