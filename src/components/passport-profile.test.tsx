import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import type { PassportBackend } from '@/lib/passport/backend'
import { renderWithIntl } from '@/test-utils'
import { PassportProfile } from './passport-profile'

/**
 * The passport's editable identity (docs/00 D30, D31): shows the saved
 * name/handle/country, expands to a form, and persists edits so uploads
 * pre-fill them. The invalid handle gate mirrors the upload wizard so a broken
 * handle can't be saved.
 */

function fakeApi(
  updateProfile: PassportBackend['updateProfile'] = vi
    .fn()
    .mockResolvedValue({ displayName: null, instagram: null, homeCountry: null }),
): PassportBackend {
  return { updateProfile } as unknown as PassportBackend
}

function render(props: Partial<Parameters<typeof PassportProfile>[0]> = {}) {
  const onSaved = props.onSaved ?? vi.fn()
  renderWithIntl(
    <PassportProfile
      displayName={props.displayName ?? null}
      instagram={props.instagram ?? null}
      homeCountry={props.homeCountry ?? null}
      api={props.api ?? fakeApi()}
      onSaved={onSaved}
    />,
  )
  return { onSaved }
}

describe('PassportProfile', () => {
  test('shows the saved name, handle and country, collapsed until edit is clicked', () => {
    render({ displayName: 'weekend warrior', instagram: 'neo_raver', homeCountry: 'NL' })
    expect(screen.getByText('@weekend warrior')).toBeInTheDocument()
    expect(screen.getByText('instagram.com/neo_raver', { exact: false })).toBeInTheDocument()
    // home country renders as flag + localized name
    expect(screen.getByText(/Netherlands/)).toBeInTheDocument()
    // the form fields aren't mounted until the user opts in
    expect(screen.queryByLabelText('instagram (optional)')).not.toBeInTheDocument()
  })

  test('offers an edit entry even when nothing is saved yet', () => {
    render({ displayName: null, instagram: null })
    expect(screen.getByRole('button', { name: 'edit profile' })).toBeInTheDocument()
  })

  test('editing saves the typed values (incl. country) and reports back what persisted', async () => {
    const user = userEvent.setup()
    // resolve values DISTINCT from the typed input so the onSaved assertion
    // proves the component forwards the backend's persisted result, not the raw
    // input it happened to send.
    const updateProfile = vi.fn().mockResolvedValue({
      displayName: 'raver (persisted)',
      instagram: 'raver_persisted',
      homeCountry: 'NL',
    })
    const { onSaved } = render({ api: fakeApi(updateProfile) })

    await user.click(screen.getByRole('button', { name: 'edit profile' }))
    await user.type(screen.getByLabelText('your name on the wall'), 'raver')
    await user.type(screen.getByLabelText('instagram (optional)'), '@raver_01')
    // pick a country from the combobox
    const picker = screen.getByRole('combobox')
    await user.click(picker)
    await user.type(picker, 'netherlands')
    await user.click(await screen.findByRole('option', { name: 'Netherlands' }))
    await user.click(screen.getByRole('button', { name: 'save' }))

    // called with the typed input (@ stripped by the shared field, country = ISO code)
    expect(updateProfile).toHaveBeenCalledWith({
      displayName: 'raver',
      instagram: 'raver_01',
      country: 'NL',
    })
    // but onSaved carries the backend's return, not the input
    await waitFor(() =>
      expect(onSaved).toHaveBeenCalledWith({
        displayName: 'raver (persisted)',
        instagram: 'raver_persisted',
        homeCountry: 'NL',
      }),
    )
    // form closes back to the collapsed view
    await waitFor(() =>
      expect(screen.queryByLabelText('instagram (optional)')).not.toBeInTheDocument(),
    )
  })

  test('a broken handle blocks save — the gate matches the upload wizard', async () => {
    const user = userEvent.setup()
    const updateProfile = vi
      .fn()
      .mockResolvedValue({ displayName: null, instagram: null, homeCountry: null })
    render({ api: fakeApi(updateProfile) })

    await user.click(screen.getByRole('button', { name: 'edit profile' }))
    await user.type(screen.getByLabelText('instagram (optional)'), 'bad handle!')
    expect(screen.getByRole('button', { name: 'save' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'save' }))
    expect(updateProfile).not.toHaveBeenCalled()
  })

  test('cancel discards the draft without saving', async () => {
    const user = userEvent.setup()
    const updateProfile = vi
      .fn()
      .mockResolvedValue({ displayName: null, instagram: null, homeCountry: null })
    render({ displayName: 'keep me', api: fakeApi(updateProfile) })

    await user.click(screen.getByRole('button', { name: 'edit profile' }))
    await user.clear(screen.getByLabelText('your name on the wall'))
    await user.type(screen.getByLabelText('your name on the wall'), 'discarded')
    await user.click(screen.getByRole('button', { name: 'cancel' }))

    expect(updateProfile).not.toHaveBeenCalled()
    expect(screen.getByText('@keep me')).toBeInTheDocument()
  })
})
