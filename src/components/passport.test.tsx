import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test } from 'vitest'
import type { EditionChip } from '@/lib/moments'
import type { PassportBackend, PassportIdentity, PassportState } from '@/lib/passport/backend'
import { momentFixture, renderWithIntl } from '@/test-utils'
import { Passport } from './passport'

/**
 * Passport spec — docs/15 §4. Moment-centric: moments are the hero; the
 * identity line reads as a story ("since <first year> · N editions", or
 * "my first defqon" for a first-timer) and the grid toggle drives it;
 * starting is anonymous with just a name.
 */

const editions: EditionChip[] = [
  { id: 'e2026', year: 2026, edition: null, canceled: true },
  { id: 'e2025', year: 2025, edition: null, canceled: false },
  { id: 'e2024', year: 2024, edition: 'Power of the Tribe', canceled: false },
]

const ANON_IDENTITY: PassportIdentity = { email: null, providers: [], isAnonymous: true }

function fakeBackend(initial: PassportState | null): PassportBackend & { toggles: string[] } {
  let state = initial
  const backend = {
    toggles: [] as string[],
    async load() {
      return state
    },
    async start(displayName: string) {
      state = {
        userId: 'u1',
        displayName,
        attendedEventIds: [],
        moments: [],
        identity: ANON_IDENTITY,
      }
      return state
    },
    async setAttendance(eventId: string, attended: boolean) {
      backend.toggles.push(`${eventId}:${attended}`)
    },
    async linkEmailStart() {},
    async linkEmailVerify(email: string) {
      const identity = { email, providers: [], isAnonymous: false }
      if (state) state = { ...state, identity }
      return identity
    },
    async linkGoogle() {},
    async signInEmailStart() {},
    async signInEmailVerify(email: string): Promise<PassportState> {
      state = {
        userId: 'u-linked',
        displayName: 'returning warrior',
        attendedEventIds: [],
        moments: [],
        identity: { email, providers: [], isAnonymous: false },
      }
      return state
    },
    async signInGoogle() {},
    async signOut() {
      state = null
    },
    async deleteAccount() {
      state = null
    },
  }
  return backend
}

describe('Passport', () => {
  test('no session → anonymous start with a name creates the journey view', async () => {
    const user = userEvent.setup()
    const backend = fakeBackend(null)
    renderWithIntl(<Passport editions={editions} backend={backend} />)

    const nameInput = await screen.findByLabelText('your name on the wall')
    await user.type(nameInput, 'weekend warrior')
    await user.click(screen.getByRole('button', { name: 'create my passport' }))

    expect(await screen.findByText('my journey')).toBeInTheDocument()
    expect(screen.getByText('@weekend warrior')).toBeInTheDocument()
    expect(screen.getByText(/tap the editions/)).toBeInTheDocument() // n=0
    expect(screen.getByText(/tap a stamp/)).toBeInTheDocument() // stamp help line
    // empty passport nudges the first upload — and shows no "+ add" tile
    expect(screen.getByRole('link', { name: 'add your first moment' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'add a moment' })).not.toBeInTheDocument()
  })

  test('checking editions updates the identity line optimistically', async () => {
    const user = userEvent.setup()
    const backend = fakeBackend({
      userId: 'u1',
      displayName: 'tester',
      attendedEventIds: ['e2024'],
      moments: [],
      identity: ANON_IDENTITY,
    })
    renderWithIntl(<Passport editions={editions} backend={backend} />)

    // n=1 → the first-timer line, not a raw ordinal
    expect(await screen.findByText('my first defqon')).toBeInTheDocument()

    // attended 2024 stamp carries its ordinal sublabel; the canceled 2026 stamp
    // reads "canceled" (its year stays the button's accessible name)
    expect(screen.getByText('1st')).toBeInTheDocument()
    expect(screen.getByText('canceled')).toBeInTheDocument()

    // add 2025 → n=2, earliest attended edition is 2024, so 2025 becomes the 2nd
    await act(async () => {
      await user.click(screen.getByRole('button', { name: '2025' }))
    })
    expect(screen.getByText('since 2024 · 2 editions')).toBeInTheDocument()
    expect(screen.getByText('2nd')).toBeInTheDocument()
    expect(backend.toggles).toContain('e2025:true')

    // remove 2024 → back to a single edition
    await act(async () => {
      await user.click(screen.getByRole('button', { name: '2024' }))
    })
    await waitFor(() => expect(screen.getByText('my first defqon')).toBeInTheDocument())
    expect(backend.toggles).toContain('e2024:false')
  })

  test('own moments render under my moments with the live count', async () => {
    const backend = fakeBackend({
      userId: 'u1',
      displayName: null,
      attendedEventIds: [],
      moments: [momentFixture('m1', { caption: 'my own moment', author_name: 'tester' })],
      identity: ANON_IDENTITY,
    })
    renderWithIntl(<Passport editions={editions} backend={backend} />)

    expect(await screen.findByText('my moments (1)')).toBeInTheDocument()
    expect(screen.getByText('my own moment')).toBeInTheDocument()
    // with moments present, the grid ends in a "+ add a moment" tile to /upload
    const addTile = screen.getByRole('link', { name: 'add a moment' })
    expect(addTile).toHaveAttribute('href', '/en/upload')
  })

  test('the journey view carries the keep-this-passport section (D16)', async () => {
    const backend = fakeBackend({
      userId: 'u1',
      displayName: 'tester',
      attendedEventIds: [],
      moments: [],
      identity: ANON_IDENTITY,
    })
    renderWithIntl(<Passport editions={editions} backend={backend} />)

    expect(await screen.findByText('keep this passport')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'connect an email' })).toBeInTheDocument()
  })

  test('a returning warrior signs in from the start screen via email OTP (D16)', async () => {
    const user = userEvent.setup()
    const backend = fakeBackend(null)
    renderWithIntl(<Passport editions={editions} backend={backend} />)

    await user.click(await screen.findByRole('button', { name: 'i already have a passport' }))
    await user.type(screen.getByLabelText('your email'), 'raver@example.com')
    await user.click(screen.getByRole('button', { name: 'send me a code' }))
    await user.type(await screen.findByLabelText('6-digit code'), '123456')
    await user.click(screen.getByRole('button', { name: 'confirm' }))

    // signed in → journey view with the linked identity
    expect(await screen.findByText('my journey')).toBeInTheDocument()
    expect(screen.getByText('@returning warrior')).toBeInTheDocument()
    expect(screen.getByText('connected as raver@example.com')).toBeInTheDocument()
  })
})
