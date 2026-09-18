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
  // never i18n routing (they're in the matcher below so www/*.vercel.app still
  // get the 308 — D23).
  const { pathname } = request.nextUrl
  // /sitemap.xml is the URL GSC and Bing hold, but app/sitemap.ts claims that
  // path even when it splits into per-locale files, and a route beside it fails
  // the build — so the index lives at its own route and is rewritten in (D60).
  if (pathname === '/sitemap.xml') {
    return NextResponse.rewrite(new URL('/sitemap-index.xml', request.url))
  }
  if (pathname === '/robots.txt' || pathname === '/llms.txt' || pathname.startsWith('/sitemap/')) {
    return NextResponse.next()
  }
  return handleI18nRouting(request)
}

export const config = {
  // Localize all pages; skip API routes, Next internals and static files.
  // Crawl files are listed explicitly so the canonical-host 308 reaches them —
  // the dotted-path exclusion above otherwise skips them (docs/00 D23).
  matcher: [
    '/((?!api|_next|_vercel|.*\\..*).*)',
    '/sitemap.xml',
    '/sitemap/:path*',
    '/robots.txt',
    '/llms.txt',
  ],
}
