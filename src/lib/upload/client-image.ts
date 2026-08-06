import imageCompression from 'browser-image-compression'
import {
  ALLOWED_MIME,
  IMAGE_MAX_DIM,
  IMAGE_MAX_ITERATIONS,
  IMAGE_QUALITY,
  MAX_FILES_PER_MOMENT,
  maxUploadBytesFor,
  SHARE_CARD_FALLBACK_MIME,
  shareCardCanRender,
  skipsClientCompression,
  TARGET_IMAGE_BYTES,
  THUMB_MAX_DIM,
  THUMB_MIME,
  THUMB_QUALITY,
  THUMB_TARGET_BYTES,
} from './constants'

/**
 * Client-side media preparation — docs/17 T2.2.
 * Photos are canvas re-encoded: that both compresses toward the size target
 * (docs/15 §2, docs/00 D47) and strips ALL metadata including GPS EXIF
 * (docs/00 D9 P6 — festival photos carry location data). GIFs skip the canvas
 * here so the uploaded original keeps its animation, and carry no EXIF to
 * begin with.
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
    // Per-type ceiling (docs/00 D47): a GIF under the photo ceiling is still too
    // large, because a GIF is stored and served at exactly the size picked here.
    const maxBytes = maxUploadBytesFor(file.type)
    if (file.size > maxBytes) {
      return { kind: 'too-large', index, maxBytes }
    }
  }
  return null
}

// Shared canvas re-encode invariants. preserveExif:false is the D9 P6 privacy
// guarantee (GPS EXIF must never survive) — kept in one place so neither the
// full-size nor the thumbnail path can silently regress it.
const BASE_COMPRESSION = { useWebWorker: true, preserveExif: false } as const

/**
 * Whether this browser's canvas can actually encode WebP. Pre-14 Safari answers
 * a WebP request with PNG instead of failing, so the thumbnail path has to ask
 * BEFORE compressing rather than read it off the output. Probed once on a 1×1
 * canvas.
 */
let webpSupport: boolean | undefined
export function canvasSupportsWebp(): boolean {
  if (webpSupport === undefined) {
    try {
      const probe = document.createElement('canvas')
      probe.width = 1
      probe.height = 1
      webpSupport = probe.toDataURL(THUMB_MIME).startsWith(`data:${THUMB_MIME}`)
    } catch {
      webpSupport = false // no canvas at all (jsdom, exotic embedded browsers)
    }
  }
  return webpSupport
}

/**
 * Keeps the SOURCE format whenever the share card can draw it, and converts
 * when it can't — the stored original is what /m/[id]'s card renders, and
 * satori drops an image it can't decode silently, so the wrong container costs
 * a moment its photo on every share with nothing failing loudly (docs/00 D47;
 * measured 1593KB card from a JPEG original vs 30KB from a WebP one).
 *
 * That cuts both ways: re-encoding everything to WebP was tried and reverted,
 * and a `.webp` the user picked — routine on Android — is converted here rather
 * than stored as-is. It costs nothing: the canvas pass happens regardless (it
 * is what strips GPS EXIF), and at the same quality number JPEG came out
 * slightly SMALLER than WebP anyway, because a quality number does not mean the
 * same thing to two codecs. The quality win in this path is the pinned
 * resolution, not the container.
 *
 * GIFs return before this and stay GIFs — animation outranks the card, which
 * has never had a photo for them.
 */
export async function prepareForUpload(file: File): Promise<File> {
  if (skipsClientCompression(file.type)) return file
  // The output is the source format unless the card can't draw it, so a PNG in
  // means a PNG out — and PNG is the one output with no quality knob. The
  // library "compresses" it by shrinking the palette, which barely moves bytes
  // on a photograph, so pinning resolution there means the size target is never
  // reached: a photo exported as PNG measured 8.7MB, ~4× what it used to be and
  // close enough to MAX_PRESIGN_BYTES that a slightly larger one is refused
  // outright. PNG therefore keeps the library's own convergence (shrink
  // resolution, iterate) exactly as it did before docs/00 D47; the pins apply
  // to formats where quality alone can converge.
  const outputsPng = file.type === 'image/png'
  return imageCompression(file, {
    ...BASE_COMPRESSION,
    maxSizeMB: TARGET_IMAGE_BYTES / (1024 * 1024),
    maxWidthOrHeight: IMAGE_MAX_DIM,
    initialQuality: IMAGE_QUALITY,
    // Quality-only convergence: never trade away pixels the viewer paid for by
    // uploading a bigger original (docs/00 D47).
    ...(outputsPng ? {} : { alwaysKeepResolution: true, maxIteration: IMAGE_MAX_ITERATIONS }),
    ...(shareCardCanRender(file.type) ? {} : { fileType: SHARE_CARD_FALLBACK_MIME }),
  })
}

/**
 * Small static thumbnail for the wall grid (docs/00 D21). Always canvas
 * re-encoded to WebP — even GIFs, which yield a static first-frame poster
 * (the animated original still lives at media_url for the lightbox). The
 * re-encode strips EXIF for free (D9 P6). Best-effort: callers fall back to
 * the full media_url when this rejects.
 *
 * The server pins thumbnails to WebP (D21), so unlike prepareForUpload there is
 * no second-best format here — a browser that can't encode WebP rejects rather
 * than spending a full compression on bytes the wizard would drop anyway.
 */
export async function prepareThumb(file: File, webp = canvasSupportsWebp()): Promise<File> {
  if (!webp) throw new Error('canvas cannot encode WebP — no thumbnail for this browser')
  return imageCompression(file, {
    ...BASE_COMPRESSION,
    maxSizeMB: THUMB_TARGET_BYTES / (1024 * 1024),
    maxWidthOrHeight: THUMB_MAX_DIM,
    fileType: THUMB_MIME,
    initialQuality: THUMB_QUALITY,
    alwaysKeepResolution: true,
  })
}

/**
 * The media's aspect ratio (width / height) so the wall skeleton reserves the
 * exact box before the photo decodes (docs/00 D32). Best-effort: any decode
 * failure (unsupported type, no createImageBitmap, jsdom) resolves null and the
 * upload proceeds without a ratio — the server clamps whatever we send anyway.
 * Callers pass the COMPRESSED (prepareForUpload) output, not the original:
 * browser-image-compression bakes EXIF orientation into the pixels, so a rotated
 * photo's raw ratio would be transposed relative to what's displayed.
 */
export async function imageAspectRatio(file: File): Promise<number | null> {
  if (typeof createImageBitmap !== 'function') return null
  try {
    const bitmap = await createImageBitmap(file)
    const ratio = bitmap.width / bitmap.height
    bitmap.close()
    return Number.isFinite(ratio) && ratio > 0 ? ratio : null
  } catch {
    return null
  }
}
