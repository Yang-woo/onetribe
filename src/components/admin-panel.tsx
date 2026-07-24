'use client'

import { useCallback, useEffect, useState } from 'react'
import { countryFlag } from '@/lib/country'
import { momentImageSrc } from '@/lib/moments'
import { supabaseBrowser } from '@/lib/supabase/browser'
import { inputClass } from './ui'

/**
 * Operator console — docs/15 §5. Post-moderation only: everything here is
 * already (or was) live. Keyboard on a focused row: h=hide d=delete o=OK.
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
  author_name: string | null
  origin_country: string | null
  created_at: string
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

  async function act(memoryId: string, action: 'hide' | 'unhide' | 'delete' | 'dismiss') {
    if (!token) return
    await fetch('/api/admin/action', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ memoryId, action }),
    })
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
        keyboard on a focused row: h = hide · d = delete · o = OK
      </p>

      <ul className="flex flex-col gap-2">
        {ordered.map((memory) => {
          const hideAction = memory.status === 'hidden' ? 'unhide' : 'hide'
          return (
            <li
              key={memory.id}
              tabIndex={0}
              aria-label={memory.caption ?? memory.id}
              onKeyDown={(e) => {
                if (e.key === 'h') void act(memory.id, hideAction)
                if (e.key === 'd') void act(memory.id, 'delete')
                if (e.key === 'o') void act(memory.id, 'dismiss')
              }}
              className="flex items-center gap-3 rounded-lg border border-line p-2 focus:border-orange"
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
                  className="rounded-full border border-red/40 px-3 py-1 text-sm text-red"
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
            </li>
          )
        })}
      </ul>
    </div>
  )
}
