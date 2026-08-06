// Shared upload rules — used by the server routes (hard enforcement) and the
// client wizard (early validation). Single source: docs/15 §2, docs/00 D9.

export const ALLOWED_MIME = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
} as const

export type AllowedMime = keyof typeof ALLOWED_MIME

/**
 * What the /m/[id] share card can actually draw. satori (next/og) decodes JPEG
 * and PNG only, and an image it can't decode is dropped **silently** — no error,
 * just a card with no photo (docs/00 D47, measured). One fact with two
 * consumers, so neither keeps its own copy: the uploader re-encodes a source
 * outside this set before storing it, and the OG route matches a stored URL
 * against it. `client-image.test.ts` pins the two forms to agree.
 */
export const SHARE_CARD_MIME: readonly string[] = ['image/jpeg', 'image/png']
export const SHARE_CARD_URL_RE = /\.(jpe?g|png)(\?|$)/i
/** Where a source the card can't draw (a .webp pick, common on Android) goes. */
export const SHARE_CARD_FALLBACK_MIME = 'image/jpeg'

export function shareCardCanRender(contentType: string): boolean {
  return SHARE_CARD_MIME.includes(contentType)
}

export const MAX_FILES_PER_MOMENT = 5 // docs/15 §2 step 1

/**
 * Types the client uploads exactly as picked instead of canvas re-encoding them
 * — GIFs, whose animation a canvas pass would flatten to one frame. This is the
 * single fact the two ceilings below hang off: a compressed type's ceiling only
 * gates what the picker accepts, while a passthrough type's ceiling IS its
 * stored (and lightbox-served) size.
 */
export function skipsClientCompression(contentType: string): boolean {
  return contentType === 'image/gif'
}

// Ceiling the PICKER applies, to the original the user chose (docs/00 D47).
// Photos are canvas re-encoded before upload, so a generous original ceiling
// costs no storage — it only stops turning away straight-from-the-camera shots.
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024
export const MAX_GIF_UPLOAD_BYTES = 10 * 1024 * 1024

/** The picker's ceiling for a type — applied to the file as chosen. */
export function maxUploadBytesFor(contentType: string): number {
  return skipsClientCompression(contentType) ? MAX_GIF_UPLOAD_BYTES : MAX_UPLOAD_BYTES
}

// Ceiling the SERVER applies, to the bytes a presign grant actually lets
// through to R2. Deliberately NOT MAX_UPLOAD_BYTES: sizes arrive as claims from
// the client and each one becomes a signed write of exactly that many bytes,
// with nothing downstream re-checking them — so tracking the picker's 20MB
// would turn a convenience for camera originals into twice the write budget for
// anyone posting sizes by hand. What legitimately arrives is a compressed photo
// (~TARGET_IMAGE_BYTES) or a GIF at its as-picked ceiling, so the largest
// honest upload sets this. One flat bound rather than a per-type one: the worst
// case is whatever the loosest type allows, so splitting it buys nothing.
export const MAX_PRESIGN_BYTES = MAX_GIF_UPLOAD_BYTES

// Compression targets (docs/00 D47). Both the full-size path and the thumbnail
// pin an explicit starting quality: browser-image-compression defaults to
// quality 1.0 and, when that overshoots, shrinks resolution AND quality 5% per
// round — so the default lands a large photo near 1440px/q0.60. Starting at
// IMAGE_QUALITY normally clears the target on the first pass, and
// alwaysKeepResolution makes the rounds that do run quality-only.
//
// The loop has a second trigger the pins can't remove: it also runs while the
// output is larger than the SOURCE file, which an already-recompressed small
// JPEG can hit even far below the target. IMAGE_MAX_ITERATIONS bounds how far
// quality can fall in that case (0.82 × 0.95³ ≈ 0.70, vs ≈ 0.49 at the
// library's default of 10 rounds).
//
// There is deliberately no IMAGE_MIME: the full-size image keeps its SOURCE
// format. WebP was tried and reverted (D47) — the share card's renderer decodes
// JPEG/PNG only and silently drops anything else, so a WebP original costs every
// new moment the photo on its card, and at equal quality numbers it wasn't even
// smaller.
export const TARGET_IMAGE_BYTES = 3 * 1024 * 1024
export const IMAGE_MAX_DIM = 3200
export const IMAGE_QUALITY = 0.82
export const IMAGE_MAX_ITERATIONS = 3

// Wall thumbnail (docs/00 D21): a small static WebP variant stored next to the
// original so the masonry grid stops downloading full-size media. GIFs get a
// static first-frame poster here — the wall shows it, the lightbox keeps the
// animated original.
export const THUMB_MAX_DIM = 640
export const THUMB_TARGET_BYTES = 200 * 1024
export const THUMB_MIME = 'image/webp' // must stay within ALLOWED_MIME (presign enum)
export const THUMB_QUALITY = 0.8 // see IMAGE_QUALITY — the default 1.0 shrinks 640px thumbs below 640px
// Presign ceiling for the thumbnail — far below MAX_PRESIGN_BYTES so a
// "thumbnail" can't inflate the storage a single presign mints (target ~200KB).
export const THUMB_MAX_UPLOAD_BYTES = 1024 * 1024
export const MAX_CAPTION_LENGTH = 500
export const MAX_AUTHOR_NAME_LENGTH = 80
export const UPLOADS_PER_HOUR = 10 // per IP (D9 P4)
export const REPORTS_PER_HOUR = 20 // per IP — reporting stays low-friction (docs/09)
export const UPLOAD_SESSION_TTL_MS = 15 * 60 * 1000

export const REPORT_REASONS = ['set-rip', 'nsfw', 'minor', 'privacy', 'spam', 'other'] as const
export type ReportReason = (typeof REPORT_REASONS)[number]
