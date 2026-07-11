import { copy } from '@/lib/copy'
import { supabaseServerAnon } from '@/lib/supabase/server-anon'

/**
 * Uploader self-takedown — the link from the upload confirmation screen.
 * The hide happens on POST (form action), never on GET: link previews and
 * prefetchers must not be able to take a moment down by merely fetching
 * the URL.
 */
export const dynamic = 'force-dynamic'

export default async function TakedownPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; token: string }>
  searchParams: Promise<{ done?: string }>
}) {
  const { id, token } = await params
  const { done } = await searchParams

  if (done === '1') {
    return <Message text={copy.takedown.done} />
  }
  if (done === '0') {
    return <Message text={copy.takedown.invalid} />
  }

  async function takedown() {
    'use server'
    const { redirect } = await import('next/navigation')
    const db = supabaseServerAnon()
    const { data } = await db.rpc('takedown_memory', { p_memory_id: id, p_token: token })
    redirect(`/t/${id}/${token}?done=${data === true ? '1' : '0'}`)
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="font-display text-2xl lowercase">{copy.takedown.confirmTitle}</h1>
      <p className="text-sm text-muted">{copy.takedown.confirmBody}</p>
      <form action={takedown}>
        <button
          type="submit"
          className="rounded-full bg-red px-6 py-3 font-medium text-paper transition-opacity hover:opacity-90"
        >
          {copy.takedown.confirm}
        </button>
      </form>
    </main>
  )
}

function Message({ text }: { text: string }) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-4 text-center">
      <p className="text-lg">{text}</p>
    </main>
  )
}
