/**
 * Donation rails (docs/00 D15) — no-perk tips that cover the server bill only.
 * null = account not opened yet; the footer link and the About #support section
 * hide themselves so a dead link never ships. Fill in the URL and redeploy.
 */
export const SUPPORT_LINKS = {
  kofi: null as string | null, // e.g. 'https://ko-fi.com/onetribeworld'
  githubSponsors: null as string | null, // e.g. 'https://github.com/sponsors/Yang-woo'
}

export function hasSupportLinks(): boolean {
  return Boolean(SUPPORT_LINKS.kofi ?? SUPPORT_LINKS.githubSponsors)
}
