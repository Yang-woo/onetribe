import { isLocalStorageDriver, localStorageStore } from '@/lib/storage/local'

/**
 * Dev/E2E-only storage endpoint backing the local storage driver.
 * Returns 404 unless the local driver is active (i.e. never with R2).
 */

function keyFrom(params: { key: string[] }): string {
  return params.key.join('/')
}

export async function PUT(
  req: Request,
  ctx: { params: Promise<{ key: string[] }> },
): Promise<Response> {
  if (!isLocalStorageDriver()) return new Response(null, { status: 404 })
  const key = keyFrom(await ctx.params)
  const bytes = new Uint8Array(await req.arrayBuffer())
  localStorageStore().set(key, {
    contentType: req.headers.get('content-type') ?? 'application/octet-stream',
    bytes,
  })
  return new Response(null, { status: 200 })
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ key: string[] }> },
): Promise<Response> {
  if (!isLocalStorageDriver()) return new Response(null, { status: 404 })
  const entry = localStorageStore().get(keyFrom(await ctx.params))
  if (!entry) return new Response(null, { status: 404 })
  return new Response(entry.bytes, {
    status: 200,
    headers: { 'content-type': entry.contentType, 'cache-control': 'no-store' },
  })
}
