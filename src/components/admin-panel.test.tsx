import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { AdminPanel } from './admin-panel'

/**
 * Operator console — the restore gate (docs/00 D55).
 *
 * The gate itself is `restore_memory`, in the database, and tests/db proves it
 * there. What this file pins is the console's half of the contract, which is
 * the half that was wrong the first time: the question must be asked about the
 * SERVER'S answer, and answering it must not be something a reflex can do.
 *
 * The queue this console draws is a snapshot — reloaded only after an action —
 * so `hidden_reason` on screen can be minutes stale. Every assertion below that
 * mentions a label therefore checks the one the 409 carried, not the one the row
 * was drawn with; the fixture deliberately makes them disagree.
 */

vi.mock('@/lib/supabase/browser', () => ({
  supabaseBrowser: () => ({
    auth: {
      getSession: async () => ({ data: { session: { access_token: 'op-token' } }, error: null }),
    },
  }),
}))

interface Row {
  id: string
  caption: string
  status: string
  hidden_reason: string | null
}

const writes: Array<{ memoryId: string; action: string; acknowledge?: string }> = []
let queueLoads = 0
/** What `/api/admin/action` answers next — one entry per call, then 200s. */
let refusals: Array<{ reason: string } | null> = []

function memory(row: Row) {
  return {
    media_url: `https://media.test/${row.id}.jpg`,
    thumb_url: null,
    media_kind: 'image',
    embed_url: null,
    author_name: null,
    origin_country: null,
    created_at: '2026-08-21T00:00:00Z',
    ...row,
  }
}

async function mountWith(rows: Row[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/api/admin/queue')) {
        queueLoads += 1
        return new Response(
          JSON.stringify({
            reports: [],
            recent: rows.map(memory),
            counters: { hidden: 0, todayLive: 0, openReports: 0 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      writes.push(JSON.parse(String(init?.body)))
      const refusal = refusals.shift()
      return refusal
        ? new Response(JSON.stringify({ error: 'confirm required', ...refusal }), { status: 409 })
        : new Response(JSON.stringify({ ok: true }), { status: 200 })
    }),
  )
  render(<AdminPanel />)
  // author-removed moments carry no report, so they only ever surface here
  await userEvent.click(await screen.findByRole('button', { name: 'recent' }))
}

async function row(caption: string) {
  const item = await screen.findByRole('listitem', { name: caption })
  return within(item)
}

beforeEach(() => {
  writes.length = 0
  refusals = []
  queueLoads = 0
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('why a moment is down', () => {
  test('a hidden row shows its label, and an unlabelled one reads as unknown', async () => {
    await mountWith([
      { id: 'a', caption: 'author took this down', status: 'hidden', hidden_reason: 'owner' },
      {
        id: 'b',
        caption: 'hidden before the column existed',
        status: 'hidden',
        hidden_reason: null,
      },
      { id: 'c', caption: 'still up', status: 'live', hidden_reason: null },
    ])
    expect(await (await row('author took this down')).findByText('(owner)')).toBeTruthy()
    // blank is what made these look safe to put back — they are not
    expect((await row('hidden before the column existed')).getByText('(unknown)')).toBeTruthy()
    const live = await row('still up')
    expect(live.queryByText(/\(/)).toBeNull()
  })
})

describe('restoring what somebody else took down', () => {
  const OWNER_ROW: Row = {
    id: 'm-owner',
    caption: 'taken down by its author',
    // Drawn as a report hide on purpose: the queue is a snapshot, and the
    // server is the one that knows. If the console ever answers from this
    // value instead of from the 409, the acknowledge assertion below breaks.
    status: 'hidden',
    hidden_reason: 'report',
  }

  test('the first click asks nothing of the server beyond the plain action', async () => {
    refusals = [{ reason: 'owner' }]
    await mountWith([OWNER_ROW])
    await (await row(OWNER_ROW.caption)).findByRole('button', { name: 'unhide' })
    await userEvent.click((await row(OWNER_ROW.caption)).getByRole('button', { name: 'unhide' }))

    // no acknowledgement is invented client-side: the server decides whether
    // one is needed at all
    expect(writes).toEqual([{ memoryId: 'm-owner', action: 'unhide' }])
    expect(
      await (await row(OWNER_ROW.caption)).findByText(/Its author took this moment down/),
    ).toBeTruthy()
  })

  test('a refusal does not reload the queue — nothing happened to reload', async () => {
    refusals = [{ reason: 'owner' }]
    await mountWith([OWNER_ROW])
    await waitFor(() => expect(queueLoads).toBe(1))
    await userEvent.click((await row(OWNER_ROW.caption)).getByRole('button', { name: 'unhide' }))
    await (await row(OWNER_ROW.caption)).findByRole('button', { name: 'restore anyway' })
    expect(queueLoads).toBe(1)
  })

  test('answering sends back the label the SERVER named', async () => {
    refusals = [{ reason: 'owner' }]
    await mountWith([OWNER_ROW])
    await userEvent.click(
      await (await row(OWNER_ROW.caption)).findByRole('button', { name: 'unhide' }),
    )
    await userEvent.click(
      await (await row(OWNER_ROW.caption)).findByRole('button', { name: 'restore anyway' }),
    )

    expect(writes).toEqual([
      { memoryId: 'm-owner', action: 'unhide' },
      // 'owner' — from the 409 — not 'report', which is what the row said
      { memoryId: 'm-owner', action: 'unhide', acknowledge: 'owner' },
    ])
    await waitFor(() => expect(queueLoads).toBe(2))
  })

  test('cancelling sends nothing and closes the question', async () => {
    refusals = [{ reason: 'token' }]
    await mountWith([OWNER_ROW])
    await userEvent.click(
      await (await row(OWNER_ROW.caption)).findByRole('button', { name: 'unhide' }),
    )
    expect(await (await row(OWNER_ROW.caption)).findByText(/held its takedown link/)).toBeTruthy()

    await userEvent.click((await row(OWNER_ROW.caption)).getByRole('button', { name: 'cancel' }))
    expect(writes).toHaveLength(1)
    expect(
      (await row(OWNER_ROW.caption)).queryByRole('button', { name: 'restore anyway' }),
    ).toBeNull()
  })

  test('the shortcut that opened the question cannot answer it', async () => {
    refusals = [{ reason: 'owner' }]
    await mountWith([OWNER_ROW])
    const item = await screen.findByRole('listitem', { name: OWNER_ROW.caption })
    item.focus()
    await userEvent.keyboard('h')
    await within(item).findByRole('button', { name: 'restore anyway' })

    // a second reflexive h — the exact shape of the Enter that a browser
    // dialog's default OK button would have swallowed
    await userEvent.keyboard('hhh')
    expect(writes).toHaveLength(1)

    await userEvent.keyboard('{Escape}')
    expect(within(item).queryByRole('button', { name: 'restore anyway' })).toBeNull()
  })

  test('a moderation hide the server does not refuse restores in one click', async () => {
    refusals = [] // the server allows it: 'report' and 'operator' are our own calls
    await mountWith([
      { id: 'm-rep', caption: 'auto-hidden', status: 'hidden', hidden_reason: 'report' },
    ])
    await userEvent.click(await (await row('auto-hidden')).findByRole('button', { name: 'unhide' }))

    // the frictionless flow moderation needs — a prompt on every row is a
    // prompt nobody reads
    expect(writes).toEqual([{ memoryId: 'm-rep', action: 'unhide' }])
    expect((await row('auto-hidden')).queryByRole('button', { name: 'restore anyway' })).toBeNull()
    await waitFor(() => expect(queueLoads).toBe(2))
  })
})
