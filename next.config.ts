import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')

// Security headers — docs/03 배포 (the reference site shipped none).
// connect-src is built from configured origins so the same policy covers
// local dev (http/ws) and production (https/wss). The browser uploads
// directly to R2 via presigned PUT, and Turnstile loads a script + frame —
// both must be allow-listed or those requests are blocked in production.
const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com'

function contentSecurityPolicy(): string {
  const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const supabaseWs = supabase.replace(/^http/, 'ws')
  // R2 presigned PUTs go to the account host (or the public media base).
  const r2 = process.env.R2_ACCOUNT_ID
    ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
    : ''
  const r2Public = process.env.R2_PUBLIC_BASE_URL ?? ''
  const connect = ['self', supabase, supabaseWs, r2, r2Public, TURNSTILE_ORIGIN]
    .filter(Boolean)
    .map((s) => (s === 'self' ? "'self'" : s))
    .join(' ')
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline' ${TURNSTILE_ORIGIN}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src ${connect}`,
    `frame-src ${TURNSTILE_ORIGIN}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ')
}

const securityHeaders = [
  { key: 'Content-Security-Policy', value: contentSecurityPolicy() },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
]

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }]
  },
}

export default withNextIntl(nextConfig)
