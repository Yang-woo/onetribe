import { countryFlag } from '@/lib/country'
import { siteUrl } from '@/lib/site-url'

/**
 * Discord webhook notifier — operator alerts for new posts and reports
 * (docs/00 D36). Best-effort BY DESIGN: a slow or failing webhook must never
 * fail, and only marginally delay, an upload or report. Server-only —
 * DISCORD_WEBHOOK_URL is NOT NEXT_PUBLIC, and the whole thing is a no-op when
 * unset (dev, or before the webhook is wired in prod). The posted content is
 * already-public wall data going to the operator's private channel, so no new
 * disclosure (docs/05).
 */

const ORANGE = 0xff6a00
const DEFCON_RED = 0xe3241d

interface DiscordEmbed {
  title?: string
  description?: string
  url?: string
  color?: number
  image?: { url: string }
  fields?: Array<{ name: string; value: string; inline?: boolean }>
}

export interface DiscordMessage {
  content?: string
  embeds?: DiscordEmbed[]
}

export type DiscordNotifier = (message: DiscordMessage) => Promise<void>

/**
 * POST a message to the configured webhook. Never throws; caps at ~3s so a hung
 * Discord can't hold the upload/report response. No-op when DISCORD_WEBHOOK_URL
 * is unset.
 */
export const notifyDiscord: DiscordNotifier = async (message) => {
  const url = process.env.DISCORD_WEBHOOK_URL
  if (!url) return
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(3000),
    })
  } catch {
    // best-effort: an operator notification must never fail the user's action.
  }
}

/** Discord embed titles cap at 256 chars — keep captions well under. */
function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

export interface MomentNotice {
  id: string
  caption: string | null
  authorName: string | null
  country: string | null // ISO 3166-1 alpha-2, or null
  imageUrl: string | null // media/thumb URL; null for external (clip) embeds
  kind: string // 'image' | 'gif' | 'clip'
}

/**
 * "New moment(s)" alert — one embed per moment so the operator sees each post's
 * image and caption inline (a batch upload becomes several embeds; Discord caps
 * a message at 10). Links each embed to its /m/[id] permalink.
 */
export function newMomentMessage(moments: MomentNotice[]): DiscordMessage {
  const base = siteUrl()
  const embeds: DiscordEmbed[] = moments.slice(0, 10).map((m) => {
    const fields = [{ name: 'by', value: m.authorName?.trim() || 'anonymous', inline: true }]
    if (m.country) {
      fields.push({
        name: 'from',
        value: `${countryFlag(m.country)} ${m.country}`.trim(),
        inline: true,
      })
    }
    fields.push({ name: 'type', value: m.kind, inline: true })
    return {
      title: m.caption ? truncate(m.caption, 200) : '(no caption)',
      url: `${base}/m/${m.id}`,
      color: ORANGE,
      ...(m.imageUrl ? { image: { url: m.imageUrl } } : {}),
      fields,
    }
  })
  return {
    content:
      moments.length > 1
        ? `🧡 ${moments.length} new moments on the wall`
        : '🧡 new moment on the wall',
    embeds,
  }
}

/** Moderation alert — a moment was reported. Links to the moment and admin. */
export function reportMessage(memoryId: string, reason: string): DiscordMessage {
  const base = siteUrl()
  return {
    embeds: [
      {
        title: `🚩 reported — ${reason}`,
        url: `${base}/m/${memoryId}`,
        color: DEFCON_RED,
        description: `[view moment](${base}/m/${memoryId}) · [admin console](${base}/admin)`,
      },
    ],
  }
}
