'use client'

import { useState } from 'react'
import { REPORT_REASONS, type ReportReason } from '@/lib/upload/constants'

const REASON_LABELS: Record<ReportReason, string> = {
  'set-rip': 'full-set recording',
  nsfw: 'NSFW content',
  minor: 'child as the focus',
  privacy: "that's me — take it down",
  spam: 'spam or ad',
  other: 'something else',
}

/**
 * Community report — the first line of defence for instant publishing
 * (docs/09 A-2). Low friction on purpose: pick a reason, done. The server
 * derives the reporter fingerprint; 3 distinct reporters auto-hide.
 */
export function ReportButton({ memoryId }: { memoryId: string }) {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle')

  async function submit(reason: ReportReason) {
    setState('sending')
    try {
      const res = await fetch('/api/report', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ memoryId, reason }),
      })
      setState(res.ok ? 'done' : 'error')
    } catch {
      setState('error')
    }
  }

  if (state === 'done') {
    return <p className="text-sm text-muted">thank you — we’ll take a look.</p>
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-sm text-muted underline-offset-2 hover:text-paper hover:underline"
      >
        report
      </button>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="report reason">
      {REPORT_REASONS.map((reason) => (
        <button
          key={reason}
          type="button"
          disabled={state === 'sending'}
          onClick={() => void submit(reason)}
          className="rounded-full border border-line px-3 py-1 text-sm text-muted hover:text-paper disabled:opacity-50"
        >
          {REASON_LABELS[reason]}
        </button>
      ))}
      {state === 'error' && <span className="text-sm text-warning">try again</span>}
    </div>
  )
}
