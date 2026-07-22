import type { Metadata, Viewport } from 'next'
import { hasLocale, NextIntlClientProvider } from 'next-intl'
import { getTranslations } from 'next-intl/server'
import { Inter, Space_Grotesk } from 'next/font/google'
import { notFound } from 'next/navigation'
import { CloudflareAnalytics } from '@/components/cloudflare-analytics'
import { SiteFooter } from '@/components/site-footer'
import { SiteHeader } from '@/components/site-header'
import { routing } from '@/i18n/routing'
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
    title: { default: 'one tribe', template: '%s — one tribe' },
    description: t('body'),
    openGraph: {
      siteName: 'one tribe',
      type: 'website',
      title: 'one tribe',
      description: t('body'),
      images: [{ url: `${base}/api/og/site`, width: 1200, height: 630 }],
    },
    twitter: { card: 'summary_large_image' },
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
    <html lang={locale} className={`${inter.variable} ${spaceGrotesk.variable} h-full antialiased`}>
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
