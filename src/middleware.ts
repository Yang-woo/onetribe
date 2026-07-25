import createMiddleware from 'next-intl/middleware'
import { NextResponse, type NextRequest } from 'next/server'
import { routing } from '@/i18n/routing'
import { canonicalHostRedirect } from '@/lib/seo'

const handleI18nRouting = createMiddleware(routing)

export default function middleware(request: NextRequest) {
  // One canonical host (docs/00 D23): www and the *.vercel.app production
  // alias 308 to onetribe.world before locale negotiation — three hosts
  // were serving identical content with no canonical signal.
  const canonical = canonicalHostRedirect(request.nextUrl)
  if (canonical) return NextResponse.redirect(canonical, 308)
  // Crawl files aren't localized — run only the canonical-host check on them,
  // never i18n routing, so /sitemap.xml and /robots.txt pass through untouched
  // (they're in the matcher below so www/*.vercel.app still get the 308 — D23).
  const { pathname } = request.nextUrl
  if (pathname === '/sitemap.xml' || pathname === '/robots.txt') {
    return NextResponse.next()
  }
  return handleI18nRouting(request)
}

export const config = {
  // Localize all pages; skip API routes, Next internals and static files.
  // Crawl files are listed explicitly so the canonical-host 308 reaches them —
  // the dotted-path exclusion above otherwise skips them (docs/00 D23).
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)', '/sitemap.xml', '/robots.txt'],
}
