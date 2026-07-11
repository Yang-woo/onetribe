import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { EditionChip } from '@/lib/moments'
import { UploadWizard } from './upload-wizard'

/**
 * Wizard spec from docs/15 §2: 3 steps with preserved state, ≤5 files,
 * rights checkbox gates submit (legal core — docs/05), completion screen
 * hands out the private delete link.
 */

const editions: EditionChip[] = [
  { id: 'e2025', year: 2025, edition: null, canceled: false },
  { id: 'e2023', year: 2023, edition: 'Path of the Warrior', canceled: false },
]

const passthroughPrepare = async (file: File) => file

function gifFile(name: string): File {
  return new File([new Uint8Array([0x47, 0x49, 0x46])], name, { type: 'image/gif' })
}

async function fillToStep3(user: ReturnType<typeof userEvent.setup>) {
  await user.upload(screen.getByLabelText('photos'), [gifFile('a.gif')])
  await user.click(screen.getByRole('button', { name: 'next' }))
  await user.selectOptions(screen.getByLabelText('edition'), 'e2023')
  await user.click(screen.getByRole('button', { name: 'next' }))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('UploadWizard', () => {
  test('rejects more than 5 files inline and blocks advancing', async () => {
    const user = userEvent.setup()
    render(<UploadWizard editions={editions} prepareImpl={passthroughPrepare} />)
    await user.upload(
      screen.getByLabelText('photos'),
      Array.from({ length: 6 }, (_, i) => gifFile(`f${i}.gif`)),
    )
    expect(screen.getByRole('alert')).toHaveTextContent('up to 5 files')
    await user.click(screen.getByRole('button', { name: 'next' }))
    expect(screen.getByLabelText('photos')).toBeInTheDocument() // still on step 1
  })

  test('back preserves earlier selections', async () => {
    const user = userEvent.setup()
    render(<UploadWizard editions={editions} prepareImpl={passthroughPrepare} />)
    await user.upload(screen.getByLabelText('photos'), [gifFile('keepme.gif')])
    await user.click(screen.getByRole('button', { name: 'next' }))
    await user.click(screen.getByRole('button', { name: 'back' }))
    expect(screen.getByText('keepme.gif')).toBeInTheDocument()
  })

  test('submit is disabled until the rights checkbox is ticked (legal gate)', async () => {
    const user = userEvent.setup()
    render(<UploadWizard editions={editions} prepareImpl={passthroughPrepare} />)
    await fillToStep3(user)

    const submit = screen.getByRole('button', { name: 'share my moment' })
    expect(submit).toBeDisabled()

    await user.click(screen.getByRole('checkbox'))
    expect(submit).toBeEnabled()

    await user.click(screen.getByRole('checkbox'))
    expect(submit).toBeDisabled()
  })

  test('happy path posts presign → PUT → memories and shows the delete link screen', async () => {
    const user = userEvent.setup()
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetchStub = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url)
      calls.push({ url: href, init })
      if (href.endsWith('/api/upload/presign')) {
        return Response.json({
          uploads: [{ key: 'm/2026/k1.gif', uploadUrl: 'https://put.test/k1', headers: {} }],
          session: 'sess-token',
        })
      }
      if (href.startsWith('https://put.test/')) return new Response(null, { status: 200 })
      if (href.endsWith('/api/memories')) {
        return Response.json(
          { moments: [{ id: 'mid-1', takedownToken: 'tok-1' }] },
          { status: 201 },
        )
      }
      throw new Error(`unexpected fetch ${href}`)
    })
    vi.stubGlobal('fetch', fetchStub)

    render(<UploadWizard editions={editions} prepareImpl={passthroughPrepare} />)
    await fillToStep3(user)
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'share my moment' }))

    expect(await screen.findByText(/it’s live/)).toBeInTheDocument()

    const memoriesCall = calls.find((c) => c.url.endsWith('/api/memories'))!
    const payload = JSON.parse(String(memoriesCall.init?.body))
    expect(payload.rightsConfirmed).toBe(true)
    expect(payload.session).toBe('sess-token')
    expect(payload.eventId).toBe('e2023')
    expect(payload.media).toEqual([{ key: 'm/2026/k1.gif', contentType: 'image/gif' }])
  })

  test('embed mode submits a YouTube link without a presign round-trip', async () => {
    const user = userEvent.setup()
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        calls.push(String(url))
        expect(String(url)).toMatch(/\/api\/memories$/)
        const payload = JSON.parse(String(init?.body))
        expect(payload.embed.url).toBe('https://youtu.be/dQw4w9WgXcQ')
        return Response.json({ moments: [{ id: 'm', takedownToken: 't' }] }, { status: 201 })
      }),
    )

    render(<UploadWizard editions={editions} prepareImpl={passthroughPrepare} />)
    await user.click(screen.getByRole('button', { name: 'link a video instead' }))
    await user.type(screen.getByLabelText('youtube link'), 'https://youtu.be/dQw4w9WgXcQ')
    await user.click(screen.getByRole('button', { name: 'next' }))
    await user.selectOptions(screen.getByLabelText('edition'), 'e2025')
    await user.click(screen.getByRole('button', { name: 'next' }))
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'share my moment' }))

    expect(await screen.findByText(/it’s live/)).toBeInTheDocument()
    expect(calls).toHaveLength(1)
  })

  test('a failed submit shows the error and posts nothing as live', async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 500 })),
    )
    render(<UploadWizard editions={editions} prepareImpl={passthroughPrepare} />)
    await fillToStep3(user)
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'share my moment' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/nothing was posted/)
  })
})
