import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createTranslator } from 'next-intl'
import { describe, expect, test } from 'vitest'
import en from '../../messages/en.json'
import type { EditionChip } from '@/lib/moments'
import type { PassportBackend, PassportState } from '@/lib/passport/backend'
import { renderWithIntl } from '@/test-utils'
import { Passport } from './passport'

/**
 * Passport spec — docs/15 §4. The badge ordinal comes from ICU
 * selectordinal (11th/21st are the classic trap cases); the grid toggle
 * drives N; starting is anonymous with just a name.
 */

const t = createTranslator({ locale: 'en', messages: en })

describe('badge ordinal (ICU selectordinal)', () => {
  test.each([
    [1, 'my 1st defqon'],
    [2, 'my 2nd defqon'],
    [3, 'my 3rd defqon'],
    [4, 'my 4th defqon'],
    [11, 'my 11th defqon'],
    [12, 'my 12th defqon'],
    [13, 'my 13th defqon'],
    [21, 'my 21st defqon'],
    [22, 'my 22nd defqon'],
    [23, 'my 23rd defqon'],
  ])('n=%i → %s', (n, expected) => {
    expect(t('passport.badge', { n })).toBe(expected)
  })
})

const editions: EditionChip[] = [
  { id: 'e2026', year: 2026, edition: null, canceled: true },
  { id: 'e2025', year: 2025, edition: null, canceled: false },
  { id: 'e2024', year: 2024, edition: 'Power of the Tribe', canceled: false },
]

function fakeBackend(initial: PassportState | null): PassportBackend & { toggles: string[] } {
  let state = initial
  const backend = {
    toggles: [] as string[],
    async load() {
      return state
    },
    async start(displayName: string) {
      state = { userId: 'u1', displayName, attendedEventIds: [], moments: [] }
      return state
    },
    async setAttendance(eventId: string, attended: boolean) {
      backend.toggles.push(`${eventId}:${attended}`)
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
  })

  test('checking editions updates the Nth badge optimistically', async () => {
    const user = userEvent.setup()
    const backend = fakeBackend({
      userId: 'u1',
      displayName: 'tester',
      attendedEventIds: ['e2024'],
      moments: [],
    })
    renderWithIntl(<Passport editions={editions} backend={backend} />)

    expect(await screen.findByText('my 1st defqon')).toBeInTheDocument()

    await act(async () => {
      await user.click(screen.getByRole('button', { name: '2025' }))
    })
    expect(screen.getByText('my 2nd defqon')).toBeInTheDocument()
    expect(backend.toggles).toContain('e2025:true')

    await act(async () => {
      await user.click(screen.getByRole('button', { name: '2024' }))
    })
    await waitFor(() => expect(screen.getByText('my 1st defqon')).toBeInTheDocument())
    expect(backend.toggles).toContain('e2024:false')
  })

  test('own moments render under my moments with the live count', async () => {
    const backend = fakeBackend({
      userId: 'u1',
      displayName: null,
      attendedEventIds: [],
      moments: [
        {
          id: 'm1',
          event_id: 'e2024',
          media_url: 'https://media.test/m1.jpg',
          thumb_url: null,
          media_kind: 'image',
          embed_url: null,
          clip_start: null,
          clip_length: null,
          caption: 'my own moment',
          source_lang: null,
          author_name: 'tester',
          author_link: null,
          origin_country: null,
          status: 'live',
          created_at: '2026-07-13T00:00:00Z',
        },
      ],
    })
    renderWithIntl(<Passport editions={editions} backend={backend} />)

    expect(await screen.findByText('my moments (1)')).toBeInTheDocument()
    expect(screen.getByText('my own moment')).toBeInTheDocument()
  })
})
