import { llmsTxt } from '@/lib/llms-txt'
import { getCachedCounters, getCachedEditions } from '@/lib/moments-cache'

/**
 * /llms.txt as a route, not a file in public/ (GEO): a static file can say
 * what this project is but never how big the wall is, and the wall figures
 * are the one thing here that originates nowhere else.
 *
 * It reads through the same cached helpers the hero does, so the number an
 * assistant quotes and the number a visitor sees cannot drift apart, and an
 * upload's cache invalidation reaches both. ANON by construction — a
 * service-role read here would put hidden rows into public plain text.
 *
 * Soft-fails: no Supabase env (CI builds) or a DB hiccup drops the figures
 * block and still serves the guide. It must never print a zero as a count.
 */
export const revalidate = 3600

export async function GET(): Promise<Response> {
  let figures = null
  try {
    const [counters, editions] = await Promise.all([getCachedCounters(), getCachedEditions()])
    figures = { ...counters, editions, asOf: new Date() }
  } catch {
    // Loud enough to notice: a silent failure here serves a figure-less guide
    // for weeks. No payload — there is nothing here that could carry a key.
    console.warn('llms.txt: live figures unavailable, serving the guide without them')
  }
  return new Response(llmsTxt(figures), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}
