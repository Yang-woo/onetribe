import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { getTranslations } from 'next-intl/server'
import { UploadWizard } from '@/components/upload-wizard'
import { normalizeCountry } from '@/lib/country'
import { isLocale } from '@/lib/locales'
import { getCachedEditions } from '@/lib/moments-cache'
import { countryFromHeaders } from '@/lib/server/request-meta'
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
  const [editions, headerBag] = await Promise.all([getCachedEditions(), headers()])
  // First guess for the country picker: the edge geo country (docs/00 D31),
  // normalized to an ISO code ('' when unknown → the picker just starts empty).
  // The passport home country, loaded client-side, overrides it when present.
  const ipCountry = normalizeCountry(countryFromHeaders(headerBag)) ?? ''
  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-10">
      <UploadWizard editions={editions} ipCountry={ipCountry} />
    </main>
  )
}
