import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { clientIp, hashIp, originCountry } from '@/lib/server/request-meta'
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
  UPLOAD_SESSION_TTL_MS,
  UPLOADS_PER_HOUR,
  type AllowedMime,
} from '@/lib/upload/constants'

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

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

const mimeValues = Object.keys(ALLOWED_MIME) as [AllowedMime, ...AllowedMime[]]

async function parseBody(req: Request): Promise<unknown | null> {
  try {
    return await req.json()
  } catch {
    return null
  }
}

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
  // opportunistic cleanup — fire and forget
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  void db.from('upload_events').delete().lt('created_at', dayAgo)
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
  if (/^[A-Za-z0-9._]{1,30}$/.test(handle)) return `https://instagram.com/${handle}`
  try {
    const url = new URL(raw)
    const host = url.hostname.replace(/^www\./, '')
    if (host !== 'instagram.com') return null
    const path = url.pathname.replace(/\/+$/, '')
    if (!/^\/[A-Za-z0-9._]{1,30}$/.test(path)) return null
    return `https://instagram.com${path}`
  } catch {
    return null
  }
}

// ── POST /api/upload/presign ────────────────────────────────────────────────

const presignSchema = z.object({
  turnstileToken: z.string().min(1).optional(),
  files: z
    .array(
      z.object({
        contentType: z.enum(mimeValues),
        size: z.number().int().positive().max(MAX_UPLOAD_BYTES),
      }),
    )
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
      parsed.data.files.map((file) =>
        deps.storage.presignUpload({
          key: `m/${year}/${randomUUID()}.${ALLOWED_MIME[file.contentType]}`,
          contentType: file.contentType,
          contentLength: file.size,
        }),
      ),
    )
    const session = createUploadSession(
      uploads.map((u) => u.key),
      UPLOAD_SESSION_TTL_MS,
      deps.sessionSecret,
    )
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
    // the legal gate — anything but literal true is a 400 (docs/05)
    rightsConfirmed: z.literal(true),
    media: z
      .array(z.object({ key: z.string().min(1), contentType: z.enum(mimeValues) }))
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
      if (!input.media.every((m) => allowed.has(m.key))) {
        return json(403, { error: 'unknown upload key' })
      }
    } else if (!(await deps.verifyTurnstile(input.turnstileToken, ip))) {
      return json(403, { error: 'verification failed' })
    }

    const ipHash = hashIp(ip, 'upload')
    if (await overRateLimit(deps.db, ipHash, UPLOADS_PER_HOUR)) {
      return json(429, { error: 'too many uploads — try again later' })
    }

    // Passport attribution: a valid anonymous-auth token links the moment
    // to its uploader (docs/15 §4). Invalid tokens are rejected, not
    // silently dropped — losing attribution quietly would be worse.
    let authorId: string | null = null
    if (input.authToken) {
      const { data: userData, error: authError } = await deps.db.auth.getUser(input.authToken)
      if (authError || !userData.user) return json(401, { error: 'invalid auth token' })
      authorId = userData.user.id
      await deps.db
        .from('profiles')
        .upsert({ id: authorId }, { onConflict: 'id', ignoreDuplicates: true })
    }

    const { data: event } = await deps.db
      .from('events')
      .select('id')
      .eq('id', input.eventId)
      .maybeSingle()
    if (!event) return json(400, { error: 'unknown event' })

    const authorLink = input.authorLink ? normalizeInstagramLink(input.authorLink) : null
    if (input.authorLink && !authorLink) return json(400, { error: 'invalid instagram link' })

    const caption = input.caption?.trim() || null
    const shared = {
      event_id: input.eventId,
      caption,
      source_lang: detectCaptionLocale(caption),
      author_name: input.authorName?.trim() || null,
      author_link: authorLink,
      author_id: authorId,
      origin_country: originCountry(req),
      rights_confirmed: true,
      status: 'live' as const,
    }

    type MemoryInsertRow = typeof shared & {
      media_kind: 'image' | 'gif' | 'clip'
      media_url?: string
      embed_url?: string
      clip_start?: number | null
      clip_length?: number | null
    }

    let rows: MemoryInsertRow[]
    if (input.media) {
      rows = input.media.map((m) => ({
        ...shared,
        media_kind: m.contentType === 'image/gif' ? ('gif' as const) : ('image' as const),
        media_url: deps.storage.publicUrl(m.key), // derived from key — client URLs are never trusted
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

    await recordRateEvent(deps.db, ipHash)
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
