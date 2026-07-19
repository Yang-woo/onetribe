import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { PassportBackend, PassportIdentity } from '@/lib/passport/backend'
import { renderWithIntl } from '@/test-utils'
import { PassportAccount } from './passport-account'

/**
 * Passport account section (docs/15 §4, D16). Anonymous → the upgrade
 * offer; upgraded → connection status + sign-out + guarded deletion.
 * Destructive/session-replacing actions must sit behind a confirm.
 */

const ANON: PassportIdentity = { email: null, providers: [], isAnonymous: true }
const LINKED: PassportIdentity = { email: 'raver@example.com', providers: [], isAnonymous: false }

function fakeApi(overrides: Partial<PassportBackend> = {}): PassportBackend {
  return {
    load: vi.fn(),
    start: vi.fn(),
    setAttendance: vi.fn(),
    linkEmailStart: vi.fn().mockResolvedValue(undefined),
    linkEmailVerify: vi.fn().mockResolvedValue(undefined),
    linkGoogle: vi.fn().mockResolvedValue(undefined),
    signInEmailStart: vi.fn().mockResolvedValue(undefined),
    signInEmailVerify: vi.fn().mockResolvedValue(undefined),
    signInGoogle: vi.fn().mockResolvedValue(undefined),
    signOut: vi.fn().mockResolvedValue(undefined),
    deleteAccount: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as PassportBackend
}

afterEach(() => vi.restoreAllMocks())

describe('PassportAccount — anonymous', () => {
  test('offers the upgrade; google stays hidden until the flag enables it', () => {
    const api = fakeApi()
    renderWithIntl(
      <PassportAccount identity={ANON} api={api} onRefresh={vi.fn()} googleEnabled={false} />,
    )
    expect(screen.getByText('keep this passport')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'connect an email' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'connect google' })).not.toBeInTheDocument()
  })

  test('google button appears with the flag and starts the link flow', async () => {
    const user = userEvent.setup()
    const api = fakeApi()
    renderWithIntl(
      <PassportAccount identity={ANON} api={api} onRefresh={vi.fn()} googleEnabled={true} />,
    )
    await user.click(screen.getByRole('button', { name: 'connect google' }))
    expect(api.linkGoogle).toHaveBeenCalledWith(expect.stringContaining('/en/passport'))
  })

  test('linking an email runs send → verify → onRefresh', async () => {
    const user = userEvent.setup()
    const api = fakeApi()
    const onRefresh = vi.fn()
    renderWithIntl(
      <PassportAccount identity={ANON} api={api} onRefresh={onRefresh} googleEnabled={false} />,
    )

    await user.click(screen.getByRole('button', { name: 'connect an email' }))
    await user.type(screen.getByLabelText('your email'), 'raver@example.com')
    await user.click(screen.getByRole('button', { name: 'send me a code' }))
    expect(api.linkEmailStart).toHaveBeenCalledWith('raver@example.com')

    await user.type(await screen.findByLabelText('6-digit code'), '123456')
    await user.click(screen.getByRole('button', { name: 'confirm' }))
    expect(api.linkEmailVerify).toHaveBeenCalledWith('raver@example.com', '123456')
    await waitFor(() => expect(onRefresh).toHaveBeenCalled())
  })

  test('"sign in instead" is gated by the stay-behind warning', async () => {
    const user = userEvent.setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderWithIntl(
      <PassportAccount identity={ANON} api={fakeApi()} onRefresh={vi.fn()} googleEnabled={false} />,
    )

    await user.click(screen.getByRole('button', { name: 'i already have a passport' }))
    expect(confirm).toHaveBeenCalled()
    // declined → the sign-in form must not appear
    expect(screen.queryByLabelText('your email')).not.toBeInTheDocument()

    confirm.mockReturnValue(true)
    await user.click(screen.getByRole('button', { name: 'i already have a passport' }))
    expect(await screen.findByLabelText('your email')).toBeInTheDocument()
  })
})

describe('PassportAccount — upgraded', () => {
  test('shows the linked email, sign-out works', async () => {
    const user = userEvent.setup()
    const api = fakeApi()
    const onRefresh = vi.fn()
    renderWithIntl(<PassportAccount identity={LINKED} api={api} onRefresh={onRefresh} />)

    expect(screen.getByText('connected as raver@example.com')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'leave this passport on this device' }))
    expect(api.signOut).toHaveBeenCalled()
    await waitFor(() => expect(onRefresh).toHaveBeenCalled())
  })

  test('a google-only identity reads as google connected', () => {
    renderWithIntl(
      <PassportAccount
        identity={{ email: null, providers: ['google'], isAnonymous: false }}
        api={fakeApi()}
        onRefresh={vi.fn()}
      />,
    )
    expect(screen.getByText('google connected')).toBeInTheDocument()
  })

  test('deletion never fires when the confirm is declined', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const api = fakeApi()
    renderWithIntl(<PassportAccount identity={LINKED} api={api} onRefresh={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'delete my passport' }))
    expect(api.deleteAccount).not.toHaveBeenCalled()
  })

  test('confirmed deletion calls the api and refreshes', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const api = fakeApi()
    const onRefresh = vi.fn()
    renderWithIntl(<PassportAccount identity={LINKED} api={api} onRefresh={onRefresh} />)

    await user.click(screen.getByRole('button', { name: 'delete my passport' }))
    expect(api.deleteAccount).toHaveBeenCalled()
    await waitFor(() => expect(onRefresh).toHaveBeenCalled())
  })
})
