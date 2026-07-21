// Shared upload rules — used by the server routes (hard enforcement) and the
// client wizard (early validation). Single source: docs/15 §2, docs/00 D9.

export const ALLOWED_MIME = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
} as const

export type AllowedMime = keyof typeof ALLOWED_MIME

export const MAX_FILES_PER_MOMENT = 5 // docs/15 §2 step 1
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024 // presign ceiling (pre-compression)
export const TARGET_IMAGE_BYTES = 2 * 1024 * 1024 // client compression target

// Wall thumbnail (docs/00 D21): a small static WebP variant stored next to the
// original so the masonry grid stops downloading full-size media. GIFs get a
// static first-frame poster here — the wall shows it, the lightbox keeps the
// animated original.
export const THUMB_MAX_DIM = 640
export const THUMB_TARGET_BYTES = 200 * 1024
export const THUMB_MIME = 'image/webp' // must stay within ALLOWED_MIME (presign enum)
// Presign ceiling for the thumbnail — far below the 10MB main-object ceiling so
// a "thumbnail" can't inflate the storage a single presign mints (target ~200KB).
export const THUMB_MAX_UPLOAD_BYTES = 1024 * 1024
export const MAX_CAPTION_LENGTH = 500
export const MAX_AUTHOR_NAME_LENGTH = 80
export const UPLOADS_PER_HOUR = 10 // per IP (D9 P4)
export const REPORTS_PER_HOUR = 20 // per IP — reporting stays low-friction (docs/09)
export const UPLOAD_SESSION_TTL_MS = 15 * 60 * 1000

export const REPORT_REASONS = ['set-rip', 'nsfw', 'minor', 'privacy', 'spam', 'other'] as const
export type ReportReason = (typeof REPORT_REASONS)[number]
