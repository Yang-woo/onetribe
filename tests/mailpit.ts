/**
 * Mailpit client for the local Supabase stack — shared by the DB integration
 * suite (vitest) and e2e (playwright), so the port, API shape and code-mining
 * regex live in exactly one place. Runner-neutral: plain fetch, no test deps.
 */

/** supabase/config.toml [local_smtp] web/API port. */
export const MAILPIT = 'http://127.0.0.1:54324'

/**
 * Poll for a fresh 6-digit code mailed to `address`, excluding a previously
 * seen `not` code. Address-scoped (never clears the mailbox) so concurrent
 * suites can't eat each other's mail; exhausted messages are skipped on
 * later polls instead of re-downloaded.
 */
export async function otpFor(address: string, not?: string, timeoutMs = 20_000): Promise<string> {
  const deadline = Date.now() + timeoutMs
  const exhausted = new Set<string>()
  while (Date.now() < deadline) {
    const list = (await (await fetch(`${MAILPIT}/api/v1/messages`)).json()) as {
      messages?: Array<{ ID: string; To?: Array<{ Address?: string }> }>
    }
    for (const mail of list.messages ?? []) {
      if (exhausted.has(mail.ID)) continue
      if (!mail.To?.some((to) => to.Address?.toLowerCase() === address.toLowerCase())) continue
      const detail = (await (await fetch(`${MAILPIT}/api/v1/message/${mail.ID}`)).json()) as {
        Text?: string
        HTML?: string
      }
      const match = `${detail.Text ?? ''} ${detail.HTML ?? ''}`.match(/\b(\d{6})\b/)
      if (match && match[1] !== not) return match[1]
      exhausted.add(mail.ID) // no code, or the stale one — never worth refetching
    }
    await new Promise((resolve) => setTimeout(resolve, 400))
  }
  throw new Error(
    `no fresh OTP mail for ${address} within ${timeoutMs}ms — is local Supabase (Mailpit :54324) up?`,
  )
}
