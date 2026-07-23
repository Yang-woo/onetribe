import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { PassportBackend, PassportIdentity, PassportState } from '@/lib/passport/backend'
import { renderWithIntl } from '@/test-utils'
import { PassportAccount } from './passport-account'

/**
 * Passport account section (docs/15 §4, D16). Anonymous → the upgrade
 * offer; upgraded → connection status + sign-out + guarded deletion.
 * Destructive/session-replacing actions must sit behind a confirm.
 */

const ANON: PassportIdentity = { email: null, providers: [], isAnonymous: true }
const LINKED: PassportIdentity = { email: 'raver@example.com', providers: [], isAnonymous: false }

const SIGNED_IN_STATE: PassportState = {
  userId: 'u-linked',
  displayName: 'returning warrior',
  instagram: null,
  attendedEventIds: [],
  moments: [],
  identity: LINKED,
}

function fakeApi(overrides: Partial<PassportBackend> = {}): PassportBackend {
  return {
    load: vi.fn(),
    start: vi.fn(),
    loadProfileDefaults: vi.fn().mockResolvedValue(null),
    updateProfile: vi.fn().mockResolvedValue({ displayName: null, instagram: null }),
    setAttendance: vi.fn(),
    linkEmailStart: vi.fn().mockResolvedValue(undefined),
    linkEmailVerify: vi.fn().mockResolvedValue(LINKED),
    linkGoogle: vi.fn().mockResolvedValue(undefined),
    signInEmailStart: vi.fn().mockResolvedValue(undefined),
    signInEmailVerify: vi.fn().mockResolvedValue(SIGNED_IN_STATE),
    signInGoogle: vi.fn().mockResolvedValue(undefined),
    signOut: vi.fn().mockResolvedValue(undefined),
    deleteAccount: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as PassportBackend
}

function renderAccount({
  identity = ANON,
  api = fakeApi(),
  onIdentity = vi.fn(),
  onState = vi.fn(),
  googleEnabled = false,
} = {}) {
  renderWithIntl(
    <PassportAccount
      identity={identity}
      api={api}
      onIdentity={onIdentity}
      onState={onState}
      googleEnabled={googleEnabled}
    />,
  )
  return { api, onIdentity, onState }
}

afterEach(() => vi.restoreAllMocks())

describe('PassportAccount — anonymous', () => {
  test('offers the upgrade; google stays hidden until the flag enables it', () => {
    renderAccount()
    expect(screen.getByText('keep this passport')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'connect an email' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'connect google' })).not.toBeInTheDocument()
  })

  test('google button appears with the flag and starts the link flow', async () => {
    const user = userEvent.setup()
    const { api } = renderAccount({ googleEnabled: true })
    await user.click(screen.getByRole('button', { name: 'connect google' }))
    expect(api.linkGoogle).toHaveBeenCalledWith(expect.stringContaining('/en/passport'))
  })

  test('linking an email runs send → verify → identity merge, no refetch', async () => {
    const user = userEvent.setup()
    const { api, onIdentity } = renderAccount()

    await user.click(screen.getByRole('button', { name: 'connect an email' }))
    await user.type(screen.getByLabelText('your email'), 'raver@example.com')
    await user.click(screen.getByRole('button', { name: 'send me a code' }))
    expect(api.linkEmailStart).toHaveBeenCalledWith('raver@example.com')

    await user.type(await screen.findByLabelText('6-digit code'), '123456')
    await user.click(screen.getByRole('button', { name: 'confirm' }))
    expect(api.linkEmailVerify).toHaveBeenCalledWith('raver@example.com', '123456')
    // the verified identity flows up as-is — the wall data didn't change
    await waitFor(() => expect(onIdentity).toHaveBeenCalledWith(LINKED))
    expect(api.load).not.toHaveBeenCalled()
  })

  test('"sign in instead" is gated by the stay-behind warning', async () => {
    const user = userEvent.setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderAccount()

    await user.click(screen.getByRole('button', { name: 'i already have a passport' }))
    expect(confirm).toHaveBeenCalled()
    // declined → the sign-in form must not appear
    expect(screen.queryByLabelText('your email')).not.toBeInTheDocument()

    confirm.mockReturnValue(true)
    await user.click(screen.getByRole('button', { name: 'i already have a passport' }))
    expect(await screen.findByLabelText('your email')).toBeInTheDocument()
  })

  test('signing in hands the returned passport state up — no second load', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { api, onState } = renderAccount()

    await user.click(screen.getByRole('button', { name: 'i already have a passport' }))
    await user.type(screen.getByLabelText('your email'), 'raver@example.com')
    await user.click(screen.getByRole('button', { name: 'send me a code' }))
    await user.type(await screen.findByLabelText('6-digit code'), '123456')
    await user.click(screen.getByRole('button', { name: 'confirm' }))

    await waitFor(() => expect(onState).toHaveBeenCalledWith(SIGNED_IN_STATE))
    expect(api.load).not.toHaveBeenCalled()
  })
})

describe('PassportAccount — upgraded', () => {
  test('shows the linked email, sign-out ends this device session', async () => {
    const user = userEvent.setup()
    const { api, onState } = renderAccount({ identity: LINKED })

    expect(screen.getByText('connected as raver@example.com')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'leave this passport on this device' }))
    expect(api.signOut).toHaveBeenCalled()
    await waitFor(() => expect(onState).toHaveBeenCalledWith(null))
  })

  test('a google-only identity reads as google connected', () => {
    renderAccount({ identity: { email: null, providers: ['google'], isAnonymous: false } })
    expect(screen.getByText('google connected')).toBeInTheDocument()
  })

  test('deletion never fires when the confirm is declined', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { api } = renderAccount({ identity: LINKED })

    await user.click(screen.getByRole('button', { name: 'delete my passport' }))
    expect(api.deleteAccount).not.toHaveBeenCalled()
  })

  test('confirmed deletion calls the api and clears the session state', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { api, onState } = renderAccount({ identity: LINKED })

    await user.click(screen.getByRole('button', { name: 'delete my passport' }))
    expect(api.deleteAccount).toHaveBeenCalled()
    await waitFor(() => expect(onState).toHaveBeenCalledWith(null))
  })

  test('a failed deletion surfaces an error and re-enables the button', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const api = fakeApi({ deleteAccount: vi.fn().mockRejectedValue(new Error('boom')) })
    const { onState } = renderAccount({ identity: LINKED, api })

    await user.click(screen.getByRole('button', { name: 'delete my passport' }))
    expect(await screen.findByText('something went wrong — try again')).toBeInTheDocument()
    expect(onState).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'delete my passport' })).toBeEnabled()
  })
})
