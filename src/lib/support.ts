/**
 * Donation rails (docs/00 D15) — no-perk tips that cover the server bill only.
 * null = account not opened yet; the footer link and the About #support section
 * hide themselves so a dead link never ships. Fill in the URL and redeploy.
 */
export const SUPPORT_LINKS = {
  kofi: 'https://ko-fi.com/onetribeworld' as string | null, // D15 rail — live 2026-07-20, one-time tips, no perks
  githubSponsors: null as string | null, // 'https://github.com/sponsors/Yang-woo' — pending GitHub approval
}

export function hasSupportLinks(): boolean {
  return Boolean(SUPPORT_LINKS.kofi ?? SUPPORT_LINKS.githubSponsors)
}
