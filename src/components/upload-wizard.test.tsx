import { screen, waitFor } from '@testing-library/react'
import { renderWithIntl } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { EditionChip } from '@/lib/moments'
import { UploadWizard } from './upload-wizard'

/**
 * Wizard spec from docs/15 §2 + redesign 2026-07-16 §3: 2 steps with preserved
 * state, ≤5 files (appended, not replaced), a mode segment, edition chips
 * (radiogroup), the rights checkbox gating submit (legal core — docs/05), and a
 * completion screen that hands out a private delete link per moment.
 */

const editions: EditionChip[] = [
  { id: 'e2025', year: 2025, edition: null, canceled: false },
  { id: 'e2023', year: 2023, edition: 'Path of the Warrior', canceled: false },
]

const passthroughPrepare = async (file: File) => file
// Thumbnail seam: canvas re-encode can't run in jsdom, so tests inject a stub
// (mirrors prepareImpl). Passthrough keeps the file; the thumb-path test below
// supplies its own stub to assert the WebP thumbnail wiring.
const passthroughThumb = async (file: File) => file

// Every test renders with both canvas seams stubbed (they can't run in jsdom);
// a test needing a real thumbnail overrides prepareThumbImpl.
const renderWizard = (overrides: Partial<Parameters<typeof UploadWizard>[0]> = {}) =>
  renderWithIntl(
    <UploadWizard
      editions={editions}
      prepareImpl={passthroughPrepare}
      prepareThumbImpl={passthroughThumb}
      {...overrides}
    />,
  )

function gifFile(name: string): File {
  return new File([new Uint8Array([0x47, 0x49, 0x46])], name, { type: 'image/gif' })
}

// Step 1 now holds media + edition + caption; step 2 holds the signature.
async function fillToStep2(user: ReturnType<typeof userEvent.setup>, editionYear = '2023') {
  await user.upload(screen.getByLabelText('photos'), [gifFile('a.gif')])
  await user.click(screen.getByRole('radio', { name: editionYear }))
  await user.click(screen.getByRole('button', { name: 'next' }))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('UploadWizard', () => {
  test('rejects more than 5 files inline and blocks advancing', async () => {
    const user = userEvent.setup()
    renderWizard()
    await user.upload(
      screen.getByLabelText('photos'),
      Array.from({ length: 6 }, (_, i) => gifFile(`f${i}.gif`)),
    )
    expect(screen.getByRole('alert')).toHaveTextContent('up to 5 files')
    await user.click(screen.getByRole('button', { name: 'next' }))
    expect(screen.getByLabelText('photos')).toBeInTheDocument() // still on step 1
  })

  test('selecting more files appends instead of replacing', async () => {
    const user = userEvent.setup()
    renderWizard()
    await user.upload(screen.getByLabelText('photos'), [gifFile('a.gif'), gifFile('b.gif')])
    expect(screen.getAllByRole('button', { name: 'remove photo' })).toHaveLength(2)
    await user.upload(screen.getByLabelText('photos'), [gifFile('c.gif')])
    // appended (old code replaced): 3 tiles, not 1
    expect(screen.getAllByRole('button', { name: 'remove photo' })).toHaveLength(3)
  })

  test('removing a photo drops just that tile', async () => {
    const user = userEvent.setup()
    renderWizard()
    await user.upload(screen.getByLabelText('photos'), [gifFile('a.gif'), gifFile('b.gif')])
    await user.click(screen.getAllByRole('button', { name: 'remove photo' })[0])
    expect(screen.getAllByRole('button', { name: 'remove photo' })).toHaveLength(1)
  })

  test('the mode segment switches between photos and a video link', async () => {
    const user = userEvent.setup()
    renderWizard()
    // photos is the default mode
    expect(screen.getByLabelText('photos')).toBeInTheDocument()
    expect(screen.queryByLabelText('youtube link')).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'video link' }))
    expect(screen.getByLabelText('youtube link')).toBeInTheDocument()
    expect(screen.queryByLabelText('photos')).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'upload photos' }))
    expect(screen.getByLabelText('photos')).toBeInTheDocument()
  })

  test('an edition chip toggles aria-checked and blocks advancing until picked', async () => {
    const user = userEvent.setup()
    renderWizard()
    await user.upload(screen.getByLabelText('photos'), [gifFile('a.gif')])
    // no edition yet → next is blocked with the needEvent error
    await user.click(screen.getByRole('button', { name: 'next' }))
    expect(screen.getByRole('alert')).toHaveTextContent('pick an edition')

    const chip = screen.getByRole('radio', { name: '2023' })
    expect(chip).toHaveAttribute('aria-checked', 'false')
    await user.click(chip)
    expect(chip).toHaveAttribute('aria-checked', 'true')
    await user.click(screen.getByRole('button', { name: 'next' }))
    // advanced to step 2 (signature)
    expect(screen.getByRole('button', { name: 'share my moment' })).toBeInTheDocument()
  })

  test('back preserves earlier selections', async () => {
    const user = userEvent.setup()
    renderWizard()
    await fillToStep2(user)
    await user.click(screen.getByRole('button', { name: 'back' }))
    // the photo tile and the edition selection both survived the round trip
    expect(screen.getAllByRole('button', { name: 'remove photo' })).toHaveLength(1)
    expect(screen.getByRole('radio', { name: '2023' })).toHaveAttribute('aria-checked', 'true')
  })

  test('submit is disabled until the rights checkbox is ticked (legal gate)', async () => {
    const user = userEvent.setup()
    renderWizard()
    await fillToStep2(user)

    const submit = screen.getByRole('button', { name: 'share my moment' })
    expect(submit).toBeDisabled()

    await user.click(screen.getByRole('checkbox'))
    expect(submit).toBeEnabled()

    await user.click(screen.getByRole('checkbox'))
    expect(submit).toBeDisabled()
  })

  // The instagram field has a fixed "@" prefix — the input holds a bare
  // handle. Typed @s and pasted profile URLs collapse live; anything else
  // surfaces the invalid hint instead of silently mangling.
  test('instagram field strips a typed @ and shows the derived profile link', async () => {
    const user = userEvent.setup()
    renderWizard()
    await fillToStep2(user)

    const ig = screen.getByLabelText<HTMLInputElement>('instagram (optional)')
    await user.type(ig, '@qdance')
    expect(ig.value).toBe('qdance')
    expect(screen.getByText('instagram.com/qdance', { exact: false })).toBeInTheDocument()
  })

  test('pasting a profile URL collapses to the handle', async () => {
    const user = userEvent.setup()
    renderWizard()
    await fillToStep2(user)

    const ig = screen.getByLabelText<HTMLInputElement>('instagram (optional)')
    await user.click(ig)
    await user.paste('https://www.instagram.com/defqon1/')
    expect(ig.value).toBe('defqon1')
    expect(screen.getByText('instagram.com/defqon1', { exact: false })).toBeInTheDocument()
  })

  test('an invalid handle shows the red hint, not a derived link', async () => {
    const user = userEvent.setup()
    renderWizard()
    await fillToStep2(user)

    const ig = screen.getByLabelText<HTMLInputElement>('instagram (optional)')
    await user.type(ig, 'bad handle!')
    expect(screen.getByText('letters, numbers, dots and underscores only')).toBeInTheDocument()
    expect(screen.queryByText('instagram.com/', { exact: false })).not.toBeInTheDocument()
  })

  test('a pasted post URL gets the profile-URL hint, not "invalid characters"', async () => {
    const user = userEvent.setup()
    renderWizard()
    await fillToStep2(user)

    const ig = screen.getByLabelText<HTMLInputElement>('instagram (optional)')
    await user.click(ig)
    await user.paste('https://instagram.com/p/Cxyz123')
    // deliberately not collapsed (a wrong handle would be worse) — the hint
    // names the actual problem instead
    expect(ig.value).toBe('https://instagram.com/p/Cxyz123')
    expect(
      screen.getByText('that’s a post link — paste your profile URL instead'),
    ).toBeInTheDocument()
  })

  // Submitting a visibly-invalid handle would burn a presign + R2 PUT before
  // /api/memories 400s (orphan object) — the wizard gates instead.
  test('an invalid handle disables submit until fixed or cleared', async () => {
    const user = userEvent.setup()
    renderWizard()
    await fillToStep2(user)
    await user.click(screen.getByRole('checkbox'))

    const submit = screen.getByRole('button', { name: 'share my moment' })
    const ig = screen.getByLabelText<HTMLInputElement>('instagram (optional)')

    await user.type(ig, 'bad handle!')
    expect(submit).toBeDisabled()

    await user.clear(ig)
    expect(submit).toBeEnabled()

    await user.type(ig, 'qdance')
    expect(submit).toBeEnabled()
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

    renderWizard()
    await fillToStep2(user)
    await user.type(screen.getByLabelText('instagram (optional)'), '@qdance')
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'share my moment' }))

    expect(await screen.findByRole('heading', { name: /on the wall/ })).toBeInTheDocument()
    // the delete link is promoted to a field + a per-link copy button
    expect(screen.getByRole('button', { name: 'copy delete link' })).toBeInTheDocument()

    const memoriesCall = calls.find((c) => c.url.endsWith('/api/memories'))!
    const payload = JSON.parse(String(memoriesCall.init?.body))
    expect(payload.rightsConfirmed).toBe(true)
    expect(payload.session).toBe('sess-token')
    expect(payload.eventId).toBe('e2023')
    expect(payload.media).toEqual([{ key: 'm/2026/k1.gif', contentType: 'image/gif' }])
    // the wizard sends the bare handle the "@" prefix UI leaves in the field
    expect(payload.authorLink).toBe('qdance')
  })

  test('generates a thumbnail: presigns it, PUTs it, and sends thumbKey (D21)', async () => {
    const user = userEvent.setup()
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const thumbStub = async () =>
      new File([new Uint8Array([1, 2, 3])], 't.webp', { type: 'image/webp' })
    const fetchStub = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url)
      calls.push({ url: href, init })
      if (href.endsWith('/api/upload/presign')) {
        return Response.json({
          uploads: [
            {
              key: 'm/2026/k1.gif',
              uploadUrl: 'https://put.test/k1',
              headers: {},
              thumb: { key: 'm/2026/k1_t.webp', uploadUrl: 'https://put.test/k1t', headers: {} },
            },
          ],
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

    renderWizard({ prepareThumbImpl: thumbStub })
    await fillToStep2(user)
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'share my moment' }))
    expect(await screen.findByRole('heading', { name: /on the wall/ })).toBeInTheDocument()

    // the presign request declares the thumbnail descriptor
    const presignCall = calls.find((c) => c.url.endsWith('/api/upload/presign'))!
    const presignBody = JSON.parse(String(presignCall.init?.body))
    expect(presignBody.files[0].thumb).toEqual({ contentType: 'image/webp', size: 3 })

    // the thumbnail object is actually uploaded
    expect(calls.some((c) => c.url === 'https://put.test/k1t')).toBe(true)

    // and memories carries the thumbKey so the server can derive thumb_url
    const memoriesCall = calls.find((c) => c.url.endsWith('/api/memories'))!
    const payload = JSON.parse(String(memoriesCall.init?.body))
    expect(payload.media).toEqual([
      { key: 'm/2026/k1.gif', thumbKey: 'm/2026/k1_t.webp', contentType: 'image/gif' },
    ])
  })

  test('a failed thumbnail PUT does not fail the upload and omits thumbKey (D21 best-effort)', async () => {
    const user = userEvent.setup()
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const thumbStub = async () =>
      new File([new Uint8Array([1, 2, 3])], 't.webp', { type: 'image/webp' })
    const fetchStub = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url)
      calls.push({ url: href, init })
      if (href.endsWith('/api/upload/presign')) {
        return Response.json({
          uploads: [
            {
              key: 'm/2026/k1.gif',
              uploadUrl: 'https://put.test/k1',
              headers: {},
              thumb: { key: 'm/2026/k1_t.webp', uploadUrl: 'https://put.test/k1t', headers: {} },
            },
          ],
          session: 'sess-token',
        })
      }
      // main object PUT succeeds; the thumbnail PUT fails
      if (href === 'https://put.test/k1') return new Response(null, { status: 200 })
      if (href === 'https://put.test/k1t') return new Response(null, { status: 500 })
      if (href.endsWith('/api/memories')) {
        return Response.json(
          { moments: [{ id: 'mid-1', takedownToken: 'tok-1' }] },
          { status: 201 },
        )
      }
      throw new Error(`unexpected fetch ${href}`)
    })
    vi.stubGlobal('fetch', fetchStub)

    renderWizard({ prepareThumbImpl: thumbStub })
    await fillToStep2(user)
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'share my moment' }))

    // the moment still publishes despite the thumbnail PUT failing
    expect(await screen.findByRole('heading', { name: /on the wall/ })).toBeInTheDocument()
    // and no thumbKey is sent — thumb_url must not point at an object that never landed
    const memoriesCall = calls.find((c) => c.url.endsWith('/api/memories'))!
    const payload = JSON.parse(String(memoriesCall.init?.body))
    expect(payload.media).toEqual([{ key: 'm/2026/k1.gif', contentType: 'image/gif' }])
  })

  test('a non-WebP thumbnail is dropped, never sent to presign or PUT (D21)', async () => {
    const user = userEvent.setup()
    const calls: Array<{ url: string; init?: RequestInit }> = []
    // a browser without WebP canvas support falls back to PNG
    const pngThumb = async () =>
      new File([new Uint8Array([1, 2, 3])], 't.png', { type: 'image/png' })
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

    renderWizard({ prepareThumbImpl: pngThumb })
    await fillToStep2(user)
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'share my moment' }))

    // the upload still succeeds, just without a thumbnail
    expect(await screen.findByRole('heading', { name: /on the wall/ })).toBeInTheDocument()
    const presignCall = calls.find((c) => c.url.endsWith('/api/upload/presign'))!
    const presignBody = JSON.parse(String(presignCall.init?.body))
    expect(presignBody.files[0].thumb).toBeUndefined() // non-WebP filtered out client-side
    expect(calls.some((c) => c.url === 'https://put.test/k1t')).toBe(false) // no thumb PUT
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

    renderWizard()
    await user.click(screen.getByRole('tab', { name: 'video link' }))
    await user.type(screen.getByLabelText('youtube link'), 'https://youtu.be/dQw4w9WgXcQ')
    await user.click(screen.getByRole('radio', { name: '2025' }))
    await user.click(screen.getByRole('button', { name: 'next' }))
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'share my moment' }))

    expect(await screen.findByRole('heading', { name: /on the wall/ })).toBeInTheDocument()
    expect(calls).toHaveLength(1)
  })

  test('a failed submit shows the error and posts nothing as live', async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 500 })),
    )
    renderWizard()
    await fillToStep2(user)
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'share my moment' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/nothing was posted/)
  })

  // Passport pre-fill (docs/00 D30): a returning uploader never re-types their
  // name/handle — the wizard seeds both from the saved profile.
  describe('passport pre-fill (D30)', () => {
    test('seeds the name and instagram fields from the saved profile', async () => {
      const user = userEvent.setup()
      renderWizard({
        loadDefaultsImpl: async () => ({ displayName: 'Neo', instagram: 'neo_raver', country: '' }),
      })
      await fillToStep2(user)

      expect(await screen.findByLabelText<HTMLInputElement>('display name')).toHaveValue('Neo')
      expect(screen.getByLabelText<HTMLInputElement>('instagram (optional)')).toHaveValue(
        'neo_raver',
      )
      // the seeded handle is treated as valid — the derived-link hint shows
      expect(screen.getByText('instagram.com/neo_raver', { exact: false })).toBeInTheDocument()
    })

    test('a pre-fill that resolves late never clobbers what the user typed', async () => {
      const user = userEvent.setup()
      let resolveDefaults!: (v: { displayName: string; instagram: string; country: string }) => void
      renderWizard({
        loadDefaultsImpl: () => new Promise((r) => (resolveDefaults = r)),
      })
      await fillToStep2(user)

      const name = await screen.findByLabelText<HTMLInputElement>('display name')
      await user.type(name, 'my chosen name')
      // the profile fetch only now resolves — seeding must skip the filled field
      resolveDefaults({ displayName: 'stale name', instagram: 'stale_ig', country: '' })
      await new Promise((r) => setTimeout(r, 0))

      expect(name).toHaveValue('my chosen name')
      // the untouched instagram field still accepts the late seed
      expect(screen.getByLabelText<HTMLInputElement>('instagram (optional)')).toHaveValue(
        'stale_ig',
      )
    })
  })

  // Home country (docs/00 D31): pre-filled from passport → IP, editable, and
  // sent to the server as an ISO code.
  describe('home country (D31)', () => {
    test('the picker starts at the IP guess; the passport home country overrides it', async () => {
      const user = userEvent.setup()
      renderWizard({
        ipCountry: 'US',
        loadDefaultsImpl: async () => ({ displayName: '', instagram: '', country: 'KR' }),
      })
      await fillToStep2(user)
      const picker = screen.getByRole('combobox') as HTMLInputElement
      // home country (KR, from the passport) wins over the IP guess (US)
      await waitFor(() => expect(picker.value).toContain('South Korea'))
    })

    test('sends the picked country as an ISO code in the memories payload', async () => {
      const user = userEvent.setup()
      const calls: Array<{ url: string; init?: RequestInit }> = []
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
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
            return Response.json({ moments: [{ id: 'm', takedownToken: 't' }] }, { status: 201 })
          }
          throw new Error(`unexpected fetch ${href}`)
        }),
      )

      renderWizard({ ipCountry: '' })
      await fillToStep2(user)
      const picker = screen.getByRole('combobox')
      await user.click(picker)
      await user.type(picker, 'netherlands')
      await user.click(await screen.findByRole('option', { name: 'Netherlands' }))
      await user.click(screen.getByRole('checkbox'))
      await user.click(screen.getByRole('button', { name: 'share my moment' }))

      expect(await screen.findByRole('heading', { name: /on the wall/ })).toBeInTheDocument()
      const memoriesCall = calls.find((c) => c.url.endsWith('/api/memories'))!
      const payload = JSON.parse(String(memoriesCall.init?.body))
      expect(payload.country).toBe('NL')
    })

    test('a late passport home country never clobbers a country the user already picked', async () => {
      const user = userEvent.setup()
      let resolveDefaults!: (v: { displayName: string; instagram: string; country: string }) => void
      renderWizard({
        ipCountry: '',
        loadDefaultsImpl: () => new Promise((r) => (resolveDefaults = r)),
      })
      await fillToStep2(user)

      // the user picks Netherlands by hand
      const picker = screen.getByRole('combobox')
      await user.click(picker)
      await user.type(picker, 'netherlands')
      await user.click(await screen.findByRole('option', { name: 'Netherlands' }))

      // the profile fetch only now resolves with a DIFFERENT home country — the
      // countryTouched guard must keep the hand-picked value (mirrors the
      // name/instagram late-clobber test above)
      resolveDefaults({ displayName: '', instagram: '', country: 'KR' })
      await new Promise((r) => setTimeout(r, 0))

      expect((picker as HTMLInputElement).value).toContain('Netherlands')
    })
  })
})
