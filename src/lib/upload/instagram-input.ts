// Live normalization for the wizard's instagram field (segmented "@" prefix
// UI): the field holds a bare handle, so a typed "@" or a pasted profile URL
// collapses to the handle as the user types. The server keeps its own
// normalization (server/upload.ts normalizeInstagramLink) — this is a UX
// nicety, not the enforcement layer.

/**
 * The accepted handle shape — single source: the server's
 * normalizeInstagramLink imports this too, so client hint and server
 * enforcement cannot drift. Mirrors Instagram's own rules: 1–30 of
 * letters/digits/._ with no leading, trailing, or consecutive dots — the
 * derived-link hint affirms "that's my profile", so it must not endorse
 * handles Instagram itself forbids. (Lookahead only — lookbehind would be a
 * parse-time SyntaxError on older mobile Safari.)
 */
export const IG_HANDLE_RE = /^(?=.{1,30}$)[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*$/

// A pasted profile URL (protocol/www optional; trailing slash, query, and
// fragment tolerated). Anchored to the end so post/reel URLs
// (instagram.com/p/…) fall through unchanged and surface the URL hint
// instead of a wrong handle.
const IG_PROFILE_URL_RE =
  /^(?:https?:\/\/)?(?:www\.)?instagram\.com\/@?([A-Za-z0-9._]{1,30})\/?(?:[?#].*)?$/i

/** Any instagram.com URL — lets the wizard pick a "paste your profile URL,
 *  not a post" hint when a non-profile URL refuses to collapse. */
const IG_URL_RE = /^(?:https?:\/\/)?(?:www\.)?instagram\.com\//i

/** Collapses "@handle" or a pasted profile URL to the bare handle. */
export function normalizeIgInput(raw: string): string {
  let value = raw.trimStart()
  // Match against a fully-trimmed copy: pastes routinely carry a trailing
  // space/newline, and the pre-prefix field tolerated that (the server's
  // new URL() trims) — the collapse must stay at least as forgiving.
  const url = value.trim().match(IG_PROFILE_URL_RE)
  if (url) value = url[1]
  if (value.startsWith('@')) value = value.slice(1)
  return value
}

/** True when input that didn't collapse still looks like an instagram URL. */
export function isIgUrl(raw: string): boolean {
  return IG_URL_RE.test(raw.trim())
}
