import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { renderWithIntl } from '@/test-utils'
import { CountryField } from './country-field'

/**
 * The "where you're from" combobox (docs/00 D31): shows the selected country,
 * filters by name/alias/code as you type, and reports the chosen ISO code.
 * Search must match what people actually type — the English name and aliases
 * ("holland", "uk") — not just the code.
 */

function render(props: Partial<Parameters<typeof CountryField>[0]> = {}) {
  const onChange = props.onChange ?? vi.fn()
  renderWithIntl(<CountryField value={props.value ?? ''} onChange={onChange} />)
  return { onChange }
}

describe('CountryField', () => {
  test('shows the selected country as a flag + localized name', () => {
    render({ value: 'NL' })
    const input = screen.getByRole('combobox') as HTMLInputElement
    expect(input.value).toContain('Netherlands')
  })

  test('typing a name filters, and picking an option reports its ISO code', async () => {
    const user = userEvent.setup()
    const { onChange } = render({ value: '' })
    const input = screen.getByRole('combobox')

    await user.type(input, 'netherlands')
    // exact name: "netherlands" also matches BQ (Caribbean Netherlands)
    const option = await screen.findByRole('option', { name: 'Netherlands' })
    await user.click(option)

    expect(onChange).toHaveBeenCalledWith('NL')
  })

  test('finds a country by a common alias, not just its official name', async () => {
    const user = userEvent.setup()
    render({ value: '' })
    const input = screen.getByRole('combobox')

    // people type "holland", not "Netherlands"
    await user.type(input, 'holland')
    expect(await screen.findByRole('option', { name: 'Netherlands' })).toBeInTheDocument()
  })

  test('keyboard: arrow down + enter selects the highlighted country', async () => {
    const user = userEvent.setup()
    const { onChange } = render({ value: '' })
    const input = screen.getByRole('combobox')

    await user.type(input, 'south korea')
    await user.keyboard('{ArrowDown}{Enter}')

    expect(onChange).toHaveBeenCalledWith('KR')
  })

  test('shows a no-match hint for gibberish', async () => {
    const user = userEvent.setup()
    render({ value: '' })
    await user.type(screen.getByRole('combobox'), 'zzzznotacountry')
    expect(await screen.findByText(/no match/i)).toBeInTheDocument()
  })
})
