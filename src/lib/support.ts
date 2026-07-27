/**
 * Donation rails (docs/00 D15) — no-perk tips that cover the server bill only.
 * null = account not opened yet; the footer link and the About #support section
 * hide themselves so a dead link never ships. Fill in the URL and redeploy.
 */
export const SUPPORT_LINKS = {
  kofi: 'https://ko-fi.com/onetribeworld' as string | null, // D15 rail — live 2026-07-20, one-time tips, no perks
  githubSponsors: null as string | null, // dropped 2026-07-28 (D15): approved, but donating meant a GitHub account + login — too much friction for a fan audience. Ko-fi is the single rail.
}

export function hasSupportLinks(): boolean {
  // `||`, not `??`: emptying a rail to '' is the obvious way to switch one off
  // without deleting the key, and `??` would stop at that empty string and hide
  // the whole section while another rail is still live.
  return Boolean(SUPPORT_LINKS.kofi || SUPPORT_LINKS.githubSponsors)
}
