import type { Metadata, Viewport } from 'next'
import { hasLocale, NextIntlClientProvider } from 'next-intl'
import { getTranslations } from 'next-intl/server'
import { Inter, Space_Grotesk, Space_Mono } from 'next/font/google'
import { notFound } from 'next/navigation'
import { CloudflareAnalytics } from '@/components/cloudflare-analytics'
import { SiteFooter } from '@/components/site-footer'
import { SiteHeader } from '@/components/site-header'
import { routing } from '@/i18n/routing'
import { HOME_TITLE, siteOpenGraph } from '@/lib/seo'
import { siteUrl } from '@/lib/site-url'
import '../globals.css'

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
})

const spaceGrotesk = Space_Grotesk({
  variable: '--font-space-grotesk',
  subsets: ['latin'],
})

// Editorial mono — the hero dateline and small technical labels only.
const spaceMono = Space_Mono({
  variable: '--font-space-mono',
  weight: '400',
  subsets: ['latin'],
})

// Meta description reuses the QA'd hero body (docs/00 D19 native pass) —
// the search snippet speaks the searcher's language without introducing a
// second, unreviewed translation layer (docs/00 D23).
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  if (!hasLocale(routing.locales, locale)) return {}
  const t = await getTranslations({ locale, namespace: 'hero' })
  const base = siteUrl()
  return {
    metadataBase: new URL(base),
    title: { default: HOME_TITLE, template: '%s — one tribe' },
    description: t('body'),
    // og:title stays the bare name on purpose: the share card already carries
    // the wordmark, and one spelling of the name everywhere is what ties the
    // entity together for models (docs/00 D59).
    openGraph: siteOpenGraph(t('body')),
    twitter: { card: 'summary_large_image' },
    // Naver Search Advisor ownership check (docs/00 D60). A public token by
    // design — it is meant to sit in every page's HTML.
    verification: {
      other: { 'naver-site-verification': '13ff988349676731ad93e1cc6c7391934a340798' },
    },
  }
}

export const viewport: Viewport = { themeColor: '#0B0908' }

export default async function LocaleLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode
  params: Promise<{ locale: string }>
}>) {
  const { locale } = await params
  if (!hasLocale(routing.locales, locale)) notFound()

  return (
    <html
      lang={locale}
      className={`${inter.variable} ${spaceGrotesk.variable} ${spaceMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col font-sans">
        <NextIntlClientProvider>
          <SiteHeader />
          {children}
          <SiteFooter />
        </NextIntlClientProvider>
        <CloudflareAnalytics />
      </body>
    </html>
  )
}
