import imageCompression from 'browser-image-compression'
import {
  ALLOWED_MIME,
  MAX_FILES_PER_MOMENT,
  MAX_UPLOAD_BYTES,
  TARGET_IMAGE_BYTES,
} from './constants'

/**
 * Client-side media preparation — docs/17 T2.2.
 * Photos are canvas re-encoded: that both compresses toward the 2MB target
 * (docs/15 §2) and strips ALL metadata including GPS EXIF (docs/00 D9 P6 —
 * festival photos carry location data). GIFs skip the canvas (it would
 * kill the animation) and carry no EXIF to begin with.
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

export async function prepareForUpload(file: File): Promise<File> {
  if (file.type === 'image/gif') return file
  return imageCompression(file, {
    maxSizeMB: TARGET_IMAGE_BYTES / (1024 * 1024),
    maxWidthOrHeight: 2400,
    useWebWorker: true,
    preserveExif: false, // GPS and all other metadata must not survive (D9 P6)
  })
}
