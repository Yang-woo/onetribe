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
  return handleI18nRouting(request)
}

export const config = {
  // Localize all pages; skip API routes, Next internals and static files.
  matcher: '/((?!api|_next|_vercel|.*\\..*).*)',
}
