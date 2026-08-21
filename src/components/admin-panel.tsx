'use client'

import { useCallback, useEffect, useState } from 'react'
import { countryFlag } from '@/lib/country'
import { momentImageSrc } from '@/lib/moments'
import { supabaseBrowser } from '@/lib/supabase/browser'
import { inputClass } from './ui'

/**
 * Operator console — docs/15 §5. Post-moderation only: everything here is
 * already (or was) live. Keyboard on a focused row: h=hide/unhide d=delete o=OK.
 * Operator-only surface → English copy on purpose (not part of the
 * user-facing i18n contract).
 */

interface AdminMemory {
  id: string
  caption: string | null
  media_url: string | null
  thumb_url: string | null
  media_kind: 'image' | 'gif' | 'clip'
  embed_url: string | null
  status: string
  /** Which path took this row down (docs/00 D55) — null while live, and null on
   *  rows hidden before the column existed, which is "unknown", not "none". */
  hidden_reason: 'owner' | 'report' | 'operator' | 'token' | null
  author_name: string | null
  origin_country: string | null
  created_at: string
}

/** The labels `restore_memory` refuses without being told what it is overruling. */
type Overruled = 'owner' | 'token' | 'unknown'

const OVERRULED_BY: Record<Overruled, string> = {
  owner: 'Its author took this moment down, not a filter.',
  token: 'Whoever held its takedown link took this moment down, not a filter.',
  unknown: 'Nothing here records who took this moment down.',
}

/**
 * What else is sitting on the moment. Restoring one of these does not clear its
 * reports (nobody adjudicated them — docs/00 D55), so a moment put back over
 * three reporters goes down again on the next one. The operator has no per-row
 * report count anywhere else in this console, so without this the safety net
 * firing later reads as the restore having silently failed.
 */
function reportNote(count: number): string {
  if (count <= 0) return ''
  const at = `Reports on it: ${count} of 3.`
  return count >= 3 ? `${at} The next one takes it down again.` : at
}

interface QueueData {
  reports: Array<{ id: string; reason: string; created_at: string; memories: AdminMemory | null }>
  recent: AdminMemory[]
  counters: { hidden: number; todayLive: number; openReports: number }
}

export function AdminPanel() {
  const [token, setToken] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loginError, setLoginError] = useState<string | null>(null)
  const [queue, setQueue] = useState<QueueData | null>(null)
  const [tab, setTab] = useState<'reports' | 'recent'>('reports')
  const [denied, setDenied] = useState(false)
  const [confirming, setConfirming] = useState<{
    id: string
    reason: Overruled
    reports: number
  } | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const loadQueue = useCallback(async (accessToken: string) => {
    const res = await fetch('/api/admin/queue', {
      headers: { authorization: `Bearer ${accessToken}` },
    })
    if (res.status === 403) {
      setDenied(true)
      return
    }
    if (res.ok) setQueue(await res.json())
  }, [])

  useEffect(() => {
    void supabaseBrowser()
      .auth.getSession()
      .then(({ data }) => {
        const accessToken = data.session?.access_token
        if (accessToken) {
          setToken(accessToken)
          void loadQueue(accessToken)
        }
      })
  }, [loadQueue])

  async function signIn() {
    setLoginError(null)
    const { data, error } = await supabaseBrowser().auth.signInWithPassword({ email, password })
    if (error || !data.session) {
      setLoginError('sign-in failed')
      return
    }
    setToken(data.session.access_token)
    await loadQueue(data.session.access_token)
  }

  /**
   * Restoring is the one action here that can undo somebody else's decision
   * (docs/00 D55), and the server is what refuses it: `unhide` on a moment its
   * author took down comes back 409 with the label to overrule. So the question
   * below is asked ABOUT THE SERVER'S ANSWER, not about the row we drew — this
   * queue is a snapshot and is routinely minutes old. Answering it re-sends the
   * same action with that label; a console that never asked would simply never
   * restore those rows.
   */
  async function act(
    memoryId: string,
    action: 'hide' | 'unhide' | 'delete' | 'dismiss',
    acknowledge?: Overruled,
  ) {
    if (!token) return
    const res = await fetch('/api/admin/action', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ memoryId, action, ...(acknowledge ? { acknowledge } : {}) }),
    })
    if (res.status === 409) {
      const body = (await res.json().catch(() => null)) as {
        reason?: Overruled
        reports?: number
      } | null
      setConfirming({
        id: memoryId,
        reason: body?.reason ?? 'unknown',
        reports: body?.reports ?? 0,
      })
      return
    }
    setConfirming(null)
    // Everything else that failed has to say so. Reloading a queue that comes
    // back looking identical is indistinguishable from "the reload hasn't
    // landed yet" — and this route now answers 404 for a row that vanished
    // under a snapshot this console is always holding.
    setActionError(res.ok ? null : `${action} failed — ${res.status}`)
    await loadQueue(token)
  }

  if (denied) return <p className="text-warning">This account is not an operator.</p>

  if (!token || !queue) {
    return (
      <form
        className="flex max-w-sm flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          void signIn()
        }}
      >
        <input
          type="email"
          aria-label="email"
          placeholder="operator email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputClass}
        />
        <input
          type="password"
          aria-label="password"
          placeholder="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputClass}
        />
        <button
          type="submit"
          className="self-start rounded-full bg-orange px-5 py-2 font-medium text-black"
        >
          sign in
        </button>
        {loginError && (
          <p role="alert" className="text-sm text-warning">
            {loginError}
          </p>
        )}
      </form>
    )
  }

  const rows: AdminMemory[] =
    tab === 'reports'
      ? queue.reports.flatMap((r) => (r.memories ? [r.memories] : []))
      : queue.recent

  // hidden rows float to the top of the reports view (docs/15 §5)
  const ordered = [...new Map(rows.map((m) => [m.id, m])).values()].sort((a, b) =>
    a.status === b.status ? 0 : a.status === 'hidden' ? -1 : 1,
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-4 text-sm text-muted">
        <span>
          hidden <strong className="text-paper">{queue.counters.hidden}</strong>
        </span>
        <span>
          live today <strong className="text-paper">{queue.counters.todayLive}</strong>
        </span>
        <span>
          open reports <strong className="text-orange">{queue.counters.openReports}</strong>
        </span>
      </div>

      {actionError && (
        <p role="alert" className="text-sm text-warning">
          {actionError}
        </p>
      )}

      <div className="flex gap-2">
        {(['reports', 'recent'] as const).map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => setTab(name)}
            className={`rounded-full border px-3 py-1 text-sm ${
              tab === name ? 'border-orange text-orange' : 'border-line text-muted'
            }`}
          >
            {name}
          </button>
        ))}
      </div>

      <p className="text-xs text-muted">
        {/* `h` is a toggle: on a row that is already down it RESTORES. Saying
            "hide" made the destructive direction the one nobody read. */}
        keyboard on a focused row: h = hide/unhide · d = delete · o = OK
      </p>

      <ul className="flex flex-col gap-2">
        {ordered.map((memory) => {
          const hideAction = memory.status === 'hidden' ? 'unhide' : 'hide'
          const asking = confirming?.id === memory.id ? confirming : null
          return (
            <li
              key={memory.id}
              tabIndex={0}
              aria-label={memory.caption ?? memory.id}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setConfirming(null)
                  return
                }
                // While this row is asking, the shortcuts stop answering it.
                // The reflex that opened the question must not be the reflex
                // that confirms overruling the person who took this down —
                // that is what a default-OK dialog gets wrong.
                if (asking) return
                if (e.key === 'h') void act(memory.id, hideAction)
                if (e.key === 'd') void act(memory.id, 'delete')
                if (e.key === 'o') void act(memory.id, 'dismiss')
              }}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-line p-2 focus:border-orange"
            >
              {(() => {
                const thumb = momentImageSrc(memory, { preferThumb: true })
                // clips have no local thumb until the CDN step; show a badge so
                // the operator can still open the reported video (set-rip risk)
                return thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={thumb} alt="" className="h-14 w-14 rounded object-cover" />
                ) : (
                  <div className="flex h-14 w-14 items-center justify-center rounded bg-surface text-xs text-muted">
                    clip
                  </div>
                )
              })()}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{memory.caption ?? '—'}</p>
                <p className="text-xs text-muted">
                  {memory.status}
                  {/* Why it is down — an author's own removal must not read as a
                      filter mistake waiting to be undone (docs/00 D55). A hidden
                      row with no label is 'unknown', not blank: blank is what
                      made those rows look safe to put back. Orange marks exactly
                      the labels the server will refuse. */}
                  {memory.status === 'hidden'
                    ? (() => {
                        const label = memory.hidden_reason ?? 'unknown'
                        const overruled = label !== 'report' && label !== 'operator'
                        return (
                          <span className={overruled ? 'text-orange' : ''}>{` (${label})`}</span>
                        )
                      })()
                    : ''}
                  {memory.author_name ? ` · @${memory.author_name}` : ''}
                  {memory.origin_country
                    ? ` · ${countryFlag(memory.origin_country)} ${memory.origin_country}`
                    : ''}
                </p>
                {memory.embed_url && (
                  <a
                    href={memory.embed_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-flame hover:underline"
                  >
                    open video ↗
                  </a>
                )}
              </div>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => void act(memory.id, hideAction)}
                  className="rounded-full border border-line px-3 py-1 text-sm text-muted hover:text-paper"
                >
                  {hideAction}
                </button>
                <button
                  type="button"
                  onClick={() => void act(memory.id, 'delete')}
                  className="rounded-full border border-red/40 px-3 py-1 text-sm text-red-strong"
                >
                  delete
                </button>
                <button
                  type="button"
                  onClick={() => void act(memory.id, 'dismiss')}
                  className="rounded-full border border-line px-3 py-1 text-sm text-muted hover:text-paper"
                >
                  OK
                </button>
              </div>
              {asking && (
                // In the row rather than a browser dialog: a dialog's default
                // button is OK, so the Enter that follows a keyboard shortcut
                // confirms the destructive direction without anyone reading
                // it. Here the only way through is to hit this button.
                <div role="alert" className="flex basis-full flex-wrap items-center gap-2 text-xs">
                  <span className="text-orange">
                    {[OVERRULED_BY[asking.reason], reportNote(asking.reports)]
                      .filter(Boolean)
                      .join(' ')}{' '}
                    Put it back on the public wall?
                  </span>
                  <button
                    type="button"
                    onClick={() => void act(memory.id, 'unhide', asking.reason)}
                    className="rounded-full border border-orange px-2 py-0.5 text-orange"
                  >
                    restore anyway
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirming(null)}
                    className="rounded-full border border-line px-2 py-0.5 text-muted"
                  >
                    cancel
                  </button>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
