import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { ReportButton } from './report-button'

// Reporting is the first defence line of instant publishing (docs/09 A-2):
// one tap to open, one tap on a reason, confirmation.

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ReportButton', () => {
  test('picking a reason posts it and thanks the reporter', async () => {
    const user = userEvent.setup()
    const fetchStub = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe('/api/report')
      expect(JSON.parse(String(init?.body))).toEqual({ memoryId: 'mem-1', reason: 'set-rip' })
      return Response.json({ ok: true }, { status: 201 })
    })
    vi.stubGlobal('fetch', fetchStub)

    render(<ReportButton memoryId="mem-1" />)
    await user.click(screen.getByRole('button', { name: 'report' }))
    await user.click(screen.getByRole('button', { name: 'full-set recording' }))

    expect(await screen.findByText(/thank you/)).toBeInTheDocument()
    expect(fetchStub).toHaveBeenCalledTimes(1)
  })

  test('a failed report keeps the reasons open with a retry hint', async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 429 })),
    )
    render(<ReportButton memoryId="mem-1" />)
    await user.click(screen.getByRole('button', { name: 'report' }))
    await user.click(screen.getByRole('button', { name: 'spam or ad' }))

    expect(await screen.findByText('try again')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'spam or ad' })).toBeInTheDocument()
  })
})
