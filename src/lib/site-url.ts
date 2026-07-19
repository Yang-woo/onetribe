/**
 * Absolute base URL for OG images, hreflang and the local storage driver.
 * Falls back to the Vercel deployment URL until onetribe.world is wired.
 */
export function siteUrl(): string {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, '')
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  return 'http://localhost:3000'
}
