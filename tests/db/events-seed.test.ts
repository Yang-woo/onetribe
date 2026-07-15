import { expect, test } from 'vitest'
import { createAnonClient } from './helpers'

/**
 * Events seed — docs/17 T1.4, data from docs/11-event-data.md.
 * Read through the anon client: proves both the data and the public
 * read policy at once.
 */

const anon = createAnonClient()

async function nlEditions() {
  const { data, error } = await anon
    .from('events')
    .select('year, edition, city, country, canceled')
    .eq('festival', 'Defqon.1')
    .order('year')
  expect(error).toBeNull()
  return data ?? []
}

test('NL mainline: one row per year, 2003 through 2027', async () => {
  const rows = await nlEditions()
  expect(rows.map((r) => r.year)).toEqual(
    Array.from({ length: 25 }, (_, i) => 2003 + i), // 2003..2027
  )
  expect(rows.every((r) => r.country === 'NL')).toBe(true)
})

test('canceled years are exactly 2020, 2021, 2026 (launch hook)', async () => {
  const rows = await nlEditions()
  const canceled = rows.filter((r) => r.canceled).map((r) => r.year)
  expect(canceled).toEqual([2020, 2021, 2026])
})

test('2019 edition is "One Tribe"', async () => {
  const rows = await nlEditions()
  expect(rows.find((r) => r.year === 2019)?.edition).toBe('One Tribe')
})

test('venue moves to Biddinghuizen from 2011 (docs/11 A)', async () => {
  const rows = await nlEditions()
  for (const row of rows) {
    if (row.year <= 2010) expect(row.city).toBe('Almere')
    else expect(row.city).toBe('Biddinghuizen')
  }
})

test('theme spot-checks against verified anthem titles', async () => {
  const rows = await nlEditions()
  const byYear = new Map(rows.map((r) => [r.year, r.edition]))
  expect(byYear.get(2013)).toBe('Weekend Warriors')
  expect(byYear.get(2016)).toBe('Dragonblood')
  expect(byYear.get(2017)).toBe('Victory Forever')
  expect(byYear.get(2024)).toBe('Power of the Tribe')
  // 2025/2026 confirmed (Wikipedia + Hardstyle Mag); 2026 keeps its anthem
  // despite being canceled mid-event (docs/11 A)
  expect(byYear.get(2025)).toBe('Where Legends Rise')
  expect(byYear.get(2026)).toBe('Sacred Oath')
})

test('only genuinely themeless years stay null (COVID 2020/21, upcoming 2027)', async () => {
  const rows = await nlEditions()
  for (const year of [2020, 2021, 2027]) {
    expect(rows.find((r) => r.year === year)?.edition).toBeNull()
  }
})

test('international editions: Australia 2009-2018, Chile 2014-2016', async () => {
  const { data: au } = await anon
    .from('events')
    .select('year, country')
    .eq('festival', 'Defqon.1 Australia')
    .order('year')
  expect(au?.map((r) => r.year)).toEqual([
    2009, 2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018,
  ])
  expect(au?.every((r) => r.country === 'AU')).toBe(true)

  const { data: cl } = await anon
    .from('events')
    .select('year, country')
    .eq('festival', 'Defqon.1 Chile')
    .order('year')
  expect(cl?.map((r) => r.year)).toEqual([2014, 2015, 2016])
  expect(cl?.every((r) => r.country === 'CL')).toBe(true)
})
