import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Stateless upload session: presign issues an HMAC-signed grant over the
 * approved storage keys; /api/memories only accepts keys from a valid,
 * unexpired grant. Turnstile is verified once (at presign) and this token
 * carries that trust — without it, anyone could insert rows pointing at
 * fabricated keys (docs/17 T2.1).
 *
 * Not bound to the client IP on purpose: mobile networks rotate IPs
 * mid-upload; the key allow-list plus a short TTL bounds the risk.
 */

export interface UploadSession {
  keys: string[]
  exp: number // epoch ms
}

function hmac(payload: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(payload).digest()
}

export function createUploadSession(keys: string[], ttlMs: number, secret: string): string {
  const payload = Buffer.from(JSON.stringify({ keys, exp: Date.now() + ttlMs })).toString(
    'base64url',
  )
  return `${payload}.${hmac(payload, secret).toString('base64url')}`
}

export function verifyUploadSession(token: string, secret: string): UploadSession | null {
  const [payload, signature] = token.split('.')
  if (!payload || !signature) return null
  let given: Buffer
  try {
    given = Buffer.from(signature, 'base64url')
  } catch {
    return null
  }
  const expected = hmac(payload, secret)
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString()) as UploadSession
    if (!Array.isArray(session.keys) || typeof session.exp !== 'number') return null
    if (session.exp < Date.now()) return null
    return session
  } catch {
    return null
  }
}

export function uploadSessionSecret(): string {
  const secret = process.env.UPLOAD_SESSION_SECRET
  if (secret) return secret
  if (process.env.NODE_ENV === 'production') {
    throw new Error('UPLOAD_SESSION_SECRET is required in production')
  }
  return 'dev-upload-session-secret'
}
