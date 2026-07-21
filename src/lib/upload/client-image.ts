import imageCompression from 'browser-image-compression'
import {
  ALLOWED_MIME,
  MAX_FILES_PER_MOMENT,
  MAX_UPLOAD_BYTES,
  TARGET_IMAGE_BYTES,
  THUMB_MAX_DIM,
  THUMB_MIME,
  THUMB_TARGET_BYTES,
} from './constants'

/**
 * Client-side media preparation — docs/17 T2.2.
 * Photos are canvas re-encoded: that both compresses toward the 2MB target
 * (docs/15 §2) and strips ALL metadata including GPS EXIF (docs/00 D9 P6 —
 * festival photos carry location data). GIFs skip the canvas here so the
 * uploaded original keeps its animation, and carry no EXIF to begin with.
 *
 * A separate small static thumbnail (prepareThumb) is generated per upload so
 * the wall grid stops fetching full-size media (docs/00 D21).
 */

export type FileValidationError =
  | { kind: 'too-many'; max: number }
  | { kind: 'unsupported-type'; index: number; type: string }
  | { kind: 'too-large'; index: number; maxBytes: number }

export function validateFiles(
  files: ReadonlyArray<Pick<File, 'type' | 'size'>>,
): FileValidationError | null {
  if (files.length > MAX_FILES_PER_MOMENT) {
    return { kind: 'too-many', max: MAX_FILES_PER_MOMENT }
  }
  for (const [index, file] of files.entries()) {
    if (!(file.type in ALLOWED_MIME)) {
      return { kind: 'unsupported-type', index, type: file.type || 'unknown' }
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return { kind: 'too-large', index, maxBytes: MAX_UPLOAD_BYTES }
    }
  }
  return null
}

// Shared canvas re-encode invariants. preserveExif:false is the D9 P6 privacy
// guarantee (GPS EXIF must never survive) — kept in one place so neither the
// full-size nor the thumbnail path can silently regress it.
const BASE_COMPRESSION = { useWebWorker: true, preserveExif: false } as const

export async function prepareForUpload(file: File): Promise<File> {
  if (file.type === 'image/gif') return file
  return imageCompression(file, {
    ...BASE_COMPRESSION,
    maxSizeMB: TARGET_IMAGE_BYTES / (1024 * 1024),
    maxWidthOrHeight: 2400,
  })
}

/**
 * Small static thumbnail for the wall grid (docs/00 D21). Always canvas
 * re-encoded to WebP — even GIFs, which yield a static first-frame poster
 * (the animated original still lives at media_url for the lightbox). The
 * re-encode strips EXIF for free (D9 P6). Best-effort: callers fall back to
 * the full media_url when this rejects.
 */
export async function prepareThumb(file: File): Promise<File> {
  return imageCompression(file, {
    ...BASE_COMPRESSION,
    maxSizeMB: THUMB_TARGET_BYTES / (1024 * 1024),
    maxWidthOrHeight: THUMB_MAX_DIM,
    fileType: THUMB_MIME,
  })
}
