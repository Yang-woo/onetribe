'use client'

import Script from 'next/script'
import { useEffect, useRef, useState } from 'react'

/**
 * Cloudflare Turnstile widget — the bot gate's client half (docs/00 D9 P4).
 * Renders only when NEXT_PUBLIC_TURNSTILE_SITE_KEY is set, so local dev
 * (no key) works without it while production gets a real token. Calls
 * onToken with the solved token; re-solves are handled by the widget.
 */

declare global {
  interface Window {
    turnstile?: {
      render: (
        el: HTMLElement,
        opts: {
          sitekey: string
          callback: (token: string) => void
          'expired-callback'?: () => void
          'error-callback'?: () => void
          theme?: 'dark' | 'light'
        },
      ) => string
      remove: (id: string) => void
    }
  }
}

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY

export function isTurnstileEnabled(): boolean {
  return Boolean(SITE_KEY)
}

export function Turnstile({ onToken }: { onToken: (token: string | null) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const widgetId = useRef<string | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!SITE_KEY || !ready || !ref.current || !window.turnstile) return
    const el = ref.current
    widgetId.current = window.turnstile.render(el, {
      sitekey: SITE_KEY,
      theme: 'dark',
      callback: (token) => onToken(token),
      'expired-callback': () => onToken(null),
      'error-callback': () => onToken(null),
    })
    return () => {
      if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current)
    }
  }, [ready, onToken])

  if (!SITE_KEY) return null
  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        onReady={() => setReady(true)}
      />
      <div ref={ref} />
    </>
  )
}
