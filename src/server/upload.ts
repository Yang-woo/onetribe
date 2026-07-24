import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { normalizeCountry } from '@/lib/country'
import { json, parseBody } from '@/lib/server/http'
import { clientIp, hashIp } from '@/lib/server/request-meta'
import { detectCaptionLocale } from '@/lib/translate/detect'
import type { TurnstileVerifier } from '@/lib/server/turnstile'
import { createUploadSession, verifyUploadSession } from '@/lib/server/upload-session'
import type { StorageAdapter } from '@/lib/storage'
import {
  ALLOWED_MIME,
  MAX_AUTHOR_NAME_LENGTH,
  MAX_CAPTION_LENGTH,
  MAX_FILES_PER_MOMENT,
  MAX_UPLOAD_BYTES,
  REPORT_REASONS,
  REPORTS_PER_HOUR,
  THUMB_MAX_UPLOAD_BYTES,
  THUMB_MIME,
  UPLOAD_SESSION_TTL_MS,
  UPLOADS_PER_HOUR,
  type AllowedMime,
} from '@/lib/upload/constants'
import { IG_HANDLE_RE } from '@/lib/upload/instagram-input'

/**
 * Upload pipeline handlers — docs/17 T2.1, structure per docs/00 D9 P1.
 * All writes happen here with the service-role client; the checks below
 * ARE the security boundary (no anon write path exists in the database).
 */

export interface UploadDeps {
  storage: StorageAdapter
  verifyTurnstile: TurnstileVerifier
  db: SupabaseClient // service role
  sessionSecret: string
}

const mimeValues = Object.keys(ALLOWED_MIME) as [AllowedMime, ...AllowedMime[]]

// ── rate limiting (DB-backed, per pseudonymized IP — D9 P4) ─────────────────

async function overRateLimit(db: SupabaseClient, ipHash: string, limit: number): Promise<boolean> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const { count, error } = await db
    .from('upload_events')
    .select('*', { count: 'exact', head: true })
    .eq('ip_hash', ipHash)
    .gte('created_at', oneHourAgo)
  if (error) throw new Error(`rate limit check failed: ${error.message}`)
  return (count ?? 0) >= limit
}

async function recordRateEvent(db: SupabaseClient, ipHash: string): Promise<void> {
  await db.from('upload_events').insert({ ip_hash: ipHash })
  // ~2% of writes sweep day-old rows, keeping the hot count query fast.
  // Must be awaited: supabase-js builders are lazy and never fire when
  // dropped with `void`.
  if (Math.random() < 0.02) {
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    await db.from('upload_events').delete().lt('created_at', dayAgo)
  }
}

// ── link normalization ──────────────────────────────────────────────────────

/** Accepts a YouTube URL, returns a canonical watch URL — or null (docs/00 D9 P7). */
export function normalizeYoutubeUrl(raw: string): string | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  const host = url.hostname.replace(/^www\.|^m\./, '')
  let id: string | null = null
  if (host === 'youtube.com') {
    if (url.pathname === '/watch') id = url.searchParams.get('v')
    else if (url.pathname.startsWith('/shorts/')) id = url.pathname.split('/')[2] ?? null
    else if (url.pathname.startsWith('/live/')) id = url.pathname.split('/')[2] ?? null
  } else if (host === 'youtu.be') {
    id = url.pathname.slice(1) || null
  }
  if (!id || !/^[A-Za-z0-9_-]{5,20}$/.test(id)) return null
  return `https://www.youtube.com/watch?v=${id}`
}

/** Accepts "@handle" or an instagram.com URL, returns a profile URL — or null. */
export function normalizeInstagramLink(raw: string): string | null {
  const handle = raw.trim().replace(/^@/, '')
  // IG_HANDLE_RE is shared with the wizard's live hint — one regex, no drift.
  if (IG_HANDLE_RE.test(handle)) return `https://instagram.com/${handle}`
  try {
    const url = new URL(raw)
    const host = url.hostname.replace(/^www\./, '')
    if (host !== 'instagram.com') return null
    const path = url.pathname.replace(/\/+$/, '')
    if (!path.startsWith('/') || !IG_HANDLE_RE.test(path.slice(1))) return null
    return `https://instagram.com${path}`
  } catch {
    return null
  }
}

// ── POST /api/upload/presign ────────────────────────────────────────────────

// A file may carry a thumbnail descriptor: the client generates a small static
// variant (docs/00 D21) and we presign a second object for it in the same grant.
const fileDescriptor = z.object({
  contentType: z.enum(mimeValues),
  size: z.number().int().positive().max(MAX_UPLOAD_BYTES),
})

// The client always generates a small static WebP thumbnail (docs/00 D21) — pin
// the MIME and a tight size ceiling so a heavy or non-WebP object can't ride in
// under the "thumb" name and defeat the point of the smaller variant.
const thumbDescriptor = fileDescriptor.extend({
  contentType: z.literal(THUMB_MIME),
  size: z.number().int().positive().max(THUMB_MAX_UPLOAD_BYTES),
})

const presignSchema = z.object({
  turnstileToken: z.string().min(1).optional(),
  files: z
    .array(fileDescriptor.extend({ thumb: thumbDescriptor.optional() }))
    .min(1)
    .max(MAX_FILES_PER_MOMENT),
})

export function createPresignHandler(deps: UploadDeps) {
  return async (req: Request): Promise<Response> => {
    const body = await parseBody(req)
    const parsed = presignSchema.safeParse(body)
    if (!parsed.success) return json(400, { error: 'invalid request', issues: parsed.error.issues })

    const ip = clientIp(req)
    if (!(await deps.verifyTurnstile(parsed.data.turnstileToken, ip))) {
      return json(403, { error: 'verification failed' })
    }
    if (await overRateLimit(deps.db, hashIp(ip, 'upload'), UPLOADS_PER_HOUR)) {
      return json(429, { error: 'too many uploads — try again later' })
    }

    const year = new Date().getUTCFullYear()
    const uploads = await Promise.all(
      parsed.data.files.map(async (file) => {
        // Main object and its thumbnail share the upload uuid (…/{uuid}.ext and
        // …/{uuid}_t.webp) so the pair is obvious in the bucket; admin delete
        // still finds the thumb via the stored thumb_url (D9-c), not the name.
        const uuid = randomUUID()
        const main = await deps.storage.presignUpload({
          key: `m/${year}/${uuid}.${ALLOWED_MIME[file.contentType]}`,
          contentType: file.contentType,
          contentLength: file.size,
        })
        const thumb = file.thumb
          ? await deps.storage.presignUpload({
              key: `m/${year}/${uuid}_t.${ALLOWED_MIME[file.thumb.contentType]}`,
              contentType: file.thumb.contentType,
              contentLength: file.thumb.size,
            })
          : undefined
        // Uniform shape (thumb always present, possibly undefined) so the grant
        // builder below stays a plain `u.thumb ?` — no union narrowing needed.
        return { ...main, thumb }
      }),
    )
    // Both keys of every pair go into the grant so /api/memories can accept the
    // thumbKey too — an unlisted thumbKey is rejected there (403).
    const session = createUploadSession(
      uploads.flatMap((u) => (u.thumb ? [u.key, u.thumb.key] : [u.key])),
      UPLOAD_SESSION_TTL_MS,
      deps.sessionSecret,
    )
    // Count the event here: presign is what mints the expensive R2 PUT grants,
    // so unbounded presigns (never completed with /api/memories) can't abuse
    // storage. The file flow does NOT record again at memories.
    await recordRateEvent(deps.db, hashIp(ip, 'upload'))
    return json(200, { uploads, session })
  }
}

// ── POST /api/memories ──────────────────────────────────────────────────────

const memoriesSchema = z
  .object({
    session: z.string().optional(),
    turnstileToken: z.string().optional(),
    authToken: z.string().optional(), // passport session — links the upload to its author
    eventId: z.uuid(),
    caption: z.string().max(MAX_CAPTION_LENGTH).optional(),
    authorName: z.string().max(MAX_AUTHOR_NAME_LENGTH).optional(),
    authorLink: z.string().max(200).optional(),
    // Country code from the picker — a well-formed non-ISO value is nulled by
    // normalizeCountry in the handler (not 400'd here), so a stale/unknown code
    // never fails an otherwise-valid upload (docs/00 D31). A code is 2 chars;
    // the cap only bounds the payload against abuse.
    country: z.string().max(8).optional(),
    // the legal gate — anything but literal true is a 400 (docs/05)
    rightsConfirmed: z.literal(true),
    media: z
      .array(
        z.object({
          key: z.string().min(1),
          thumbKey: z.string().min(1).optional(),
          contentType: z.enum(mimeValues),
        }),
      )
      .min(1)
      .max(MAX_FILES_PER_MOMENT)
      .optional(),
    embed: z
      .object({
        url: z.string().max(300),
        clipStart: z.number().int().min(0).optional(),
        clipLength: z.number().int().positive().max(600).optional(),
      })
      .optional(),
  })
  .refine((v) => Boolean(v.media) !== Boolean(v.embed), {
    message: 'exactly one of media or embed is required',
  })

/**
 * The passport "fill-empty" identity write-back (docs/00 D30, D31): a field is
 * registered only when the upload supplies it AND the profile has none yet.
 * Once set, a later upload credits just that row (author_name/link + the row's
 * origin_country) and never overwrites the saved identity — the passport editor
 * is the one place that changes it. Each field fills independently. Pure, so the
 * rule is unit-tested without a database.
 */
export function fillEmptyIdentity(
  current: {
    display_name: string | null
    instagram: string | null
    home_country: string | null
  } | null,
  next: { name?: string; handle?: string; country?: string | null },
): { display_name?: string; instagram?: string; home_country?: string } {
  const identity: { display_name?: string; instagram?: string; home_country?: string } = {}
  if (next.name && !current?.display_name) identity.display_name = next.name
  if (next.handle && !current?.instagram) identity.instagram = next.handle
  if (next.country && !current?.home_country) identity.home_country = next.country
  return identity
}

export function createMemoriesHandler(deps: UploadDeps) {
  return async (req: Request): Promise<Response> => {
    const body = await parseBody(req)
    const parsed = memoriesSchema.safeParse(body)
    if (!parsed.success) return json(400, { error: 'invalid request', issues: parsed.error.issues })
    const input = parsed.data
    const ip = clientIp(req)

    // Trust gate: file flow carries the presign session (Turnstile was
    // verified there); the embed flow has no presign, so it brings its own
    // Turnstile token.
    if (input.media) {
      const session = input.session ? verifyUploadSession(input.session, deps.sessionSecret) : null
      if (!session) return json(403, { error: 'invalid or expired upload session' })
      const allowed = new Set(session.keys)
      // Both the media key AND its thumbKey must be in the grant — otherwise a
      // caller could point thumb_url at an arbitrary bucket object.
      const claimed = input.media.flatMap((m) => (m.thumbKey ? [m.key, m.thumbKey] : [m.key]))
      if (!claimed.every((key) => allowed.has(key))) {
        return json(403, { error: 'unknown upload key' })
      }
    } else if (!(await deps.verifyTurnstile(input.turnstileToken, ip))) {
      return json(403, { error: 'verification failed' })
    }

    // Independent pre-checks run concurrently; results apply in a fixed
    // precedence (429 rate → 401 auth → 400 event) so errors stay
    // deterministic.
    const ipHash = hashIp(ip, 'upload')
    const [limited, authUser, event] = await Promise.all([
      overRateLimit(deps.db, ipHash, UPLOADS_PER_HOUR),
      input.authToken ? deps.db.auth.getUser(input.authToken) : Promise.resolve(null),
      deps.db.from('events').select('id').eq('id', input.eventId).maybeSingle(),
    ])

    if (limited) return json(429, { error: 'too many uploads — try again later' })

    // Passport attribution: a valid anonymous-auth token links the moment
    // to its uploader (docs/15 §4). Invalid tokens are rejected, not
    // silently dropped — losing attribution quietly would be worse.
    let authorId: string | null = null
    if (input.authToken) {
      if (authUser?.error || !authUser?.data.user) {
        return json(401, { error: 'invalid auth token' })
      }
      authorId = authUser.data.user.id
    }

    if (!event.data) return json(400, { error: 'unknown event' })

    const authorLink = input.authorLink ? normalizeInstagramLink(input.authorLink) : null
    if (input.authorLink && !authorLink) return json(400, { error: 'invalid instagram link' })

    // Country: only what the picker actually holds, validated to an ISO code
    // (docs/00 D31). NO IP fallback at post time — an empty picker publishes no
    // country, so the "(optional)" label is honest and we never publish an
    // undisclosed IP-inferred location (brand-legal 2026-07-24). The picker is
    // still IP-prefilled client-side, so IP stays a visible default, not a
    // silent one. Non-sensitive — drives display + "M countries", never auth.
    const country = normalizeCountry(input.country)

    // Ensure the profile row exists for the author_id FK before inserting the
    // memory. The reusable identity (display_name/instagram, docs/00 D30) is
    // written only AFTER a successful insert (below) so a failed insert can't
    // mutate the saved identity — the two writes aren't atomic (code review
    // 2026-07-24).
    if (authorId) {
      const { error: rowError } = await deps.db
        .from('profiles')
        .upsert({ id: authorId }, { onConflict: 'id', ignoreDuplicates: true })
      if (rowError) return json(500, { error: 'could not save your moment' })
    }

    const caption = input.caption?.trim() || null
    const shared = {
      event_id: input.eventId,
      caption,
      source_lang: detectCaptionLocale(caption),
      author_name: input.authorName?.trim() || null,
      author_link: authorLink,
      author_id: authorId,
      origin_country: country,
      rights_confirmed: true,
      status: 'live' as const,
    }

    type MemoryInsertRow = typeof shared & {
      media_kind: 'image' | 'gif' | 'clip'
      media_url?: string
      thumb_url?: string | null
      embed_url?: string
      clip_start?: number | null
      clip_length?: number | null
    }

    let rows: MemoryInsertRow[]
    if (input.media) {
      rows = input.media.map((m) => ({
        ...shared,
        media_kind: m.contentType === 'image/gif' ? ('gif' as const) : ('image' as const),
        // Both URLs are derived from server-held keys — client URLs are never trusted.
        media_url: deps.storage.publicUrl(m.key),
        thumb_url: m.thumbKey ? deps.storage.publicUrl(m.thumbKey) : null,
      }))
    } else {
      const embedUrl = normalizeYoutubeUrl(input.embed!.url)
      if (!embedUrl) return json(400, { error: 'only YouTube links are supported' })
      rows = [
        {
          ...shared,
          media_kind: 'clip' as const,
          embed_url: embedUrl,
          clip_start: input.embed!.clipStart ?? null,
          clip_length: input.embed!.clipLength ?? null,
        },
      ]
    }

    const { data: inserted, error } = await deps.db
      .from('memories')
      .insert(rows)
      .select('id, takedown_token')
    if (error || !inserted) return json(500, { error: 'could not save your moment' })

    // Register the reusable identity (name / handle / home country) so the next
    // upload — and the passport — pre-fill it (docs/00 D30, D31). Runs only now
    // that the moment is safely stored, and best-effort: a failure here must not
    // fail an upload that already succeeded. The fill-empty rule (first upload
    // registers an empty field; a later edit credits just that row, never the
    // saved identity) lives in fillEmptyIdentity. Handle stored bare (the
    // field/editor hold a bare handle; the memory row keeps the full URL).
    if (authorId) {
      const name = input.authorName?.trim()
      const handle = authorLink ? new URL(authorLink).pathname.replace(/^\/+/, '') : undefined
      if (name || handle || country) {
        const { data: current } = await deps.db
          .from('profiles')
          .select('display_name, instagram, home_country')
          .eq('id', authorId)
          .single()
        const identity = fillEmptyIdentity(current, { name, handle, country })
        if (Object.keys(identity).length > 0) {
          await deps.db.from('profiles').update(identity).eq('id', authorId)
        }
      }
    }

    // File uploads were already counted at presign; only the embed flow (no
    // presign) records its rate event here — otherwise a file upload would
    // consume two of the hourly budget.
    if (input.embed) await recordRateEvent(deps.db, ipHash)
    return json(201, {
      moments: inserted.map((row) => ({ id: row.id, takedownToken: row.takedown_token })),
    })
  }
}

// ── POST /api/report ────────────────────────────────────────────────────────
// Server-computed reporter_hint: a client-supplied hint would let anyone
// forge 3 "distinct reporters" and auto-hide any memory (docs/09 A-2).

const reportSchema = z.object({
  memoryId: z.uuid(),
  reason: z.enum(REPORT_REASONS),
})

export function createReportHandler(deps: Pick<UploadDeps, 'db'>) {
  return async (req: Request): Promise<Response> => {
    const body = await parseBody(req)
    const parsed = reportSchema.safeParse(body)
    if (!parsed.success) return json(400, { error: 'invalid request' })

    const ip = clientIp(req)
    const reportScopedHash = hashIp(ip, 'report')
    if (await overRateLimit(deps.db, reportScopedHash, REPORTS_PER_HOUR)) {
      return json(429, { error: 'too many reports — try again later' })
    }

    const { error } = await deps.db.from('reports').insert({
      memory_id: parsed.data.memoryId,
      reason: parsed.data.reason,
      reporter_hint: hashIp(ip, 'reporter'),
    })
    if (error) return json(400, { error: 'could not file report' })

    await recordRateEvent(deps.db, reportScopedHash)
    return json(201, { ok: true })
  }
}
