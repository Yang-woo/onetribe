import { render } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import en from '../messages/en.json'

/** Component tests run under the EN messages — same provider as production. */
export function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      {ui}
    </NextIntlClientProvider>,
  )
}
