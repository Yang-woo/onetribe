import Script from 'next/script'

/**
 * Cloudflare Web Analytics beacon (docs/00 D22).
 * Cookieless, privacy-first page-view + country metrics — no cross-site
 * tracking, no ad cookies, consistent with the privacy policy (docs/10).
 * Renders only when NEXT_PUBLIC_CF_ANALYTICS_TOKEN is set, so local dev and
 * preview deploys stay out of the numbers — set the token in the Vercel
 * *Production* scope only. The token is public by design: it ships in the
 * page HTML, so NEXT_PUBLIC is correct and there is no secret to leak.
 */

const TOKEN = process.env.NEXT_PUBLIC_CF_ANALYTICS_TOKEN

export function CloudflareAnalytics() {
  if (!TOKEN) return null
  return (
    <Script
      src="https://static.cloudflareinsights.com/beacon.min.js"
      strategy="afterInteractive"
      data-cf-beacon={JSON.stringify({ token: TOKEN })}
    />
  )
}
