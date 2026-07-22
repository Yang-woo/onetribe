import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { Passport } from '@/components/passport'
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
  const t = await getTranslations({ locale, namespace: 'passport' })
  return { title: t('title'), alternates: localeAlternates('/passport', locale) }
}

export default async function PassportPage() {
  const t = await getTranslations('passport')
  const editions = await getCachedEditions()
  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-10">
      <h1 className="mb-8 font-display text-3xl lowercase tracking-tight">{t('title')}</h1>
      <Passport editions={editions} />
    </main>
  )
}
