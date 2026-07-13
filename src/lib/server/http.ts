/** Shared route-handler plumbing — one response envelope, one body parser. */

export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

export async function parseBody(req: Request): Promise<unknown | null> {
  try {
    return await req.json()
  } catch {
    return null
  }
}
