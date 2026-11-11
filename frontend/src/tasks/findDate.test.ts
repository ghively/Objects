import { describe, expect, test } from 'vitest'
import { findDatePhrase } from './findDate'

// Wednesday.
const TODAY = '2026-11-11'

describe('findDatePhrase', () => {
  test('test date words anywhere in the text are found and taken out of the title', () => {
    expect(findDatePhrase('Call Pat friday', TODAY)).toEqual({ day: '2026-11-13', phrase: 'friday', title: 'Call Pat' })
    expect(findDatePhrase('tomorrow call Pat', TODAY)).toEqual({ day: '2026-11-12', phrase: 'tomorrow', title: 'call Pat' })
    expect(findDatePhrase('Send the nov 20 report draft', TODAY)).toEqual({ day: '2026-11-20', phrase: 'nov 20', title: 'Send the report draft' })
    expect(findDatePhrase('Plan the trip next week', TODAY)).toEqual({ day: '2026-11-18', phrase: 'next week', title: 'Plan the trip' })
    expect(findDatePhrase('Water plants in 3 days', TODAY)).toEqual({ day: '2026-11-14', phrase: 'in 3 days', title: 'Water plants' })
    expect(findDatePhrase('Pay rent today', TODAY)?.day).toBe(TODAY)
    expect(findDatePhrase('Book flights 2026-12-01', TODAY)?.day).toBe('2026-12-01')
  })

  test('the longest phrase wins, and an "on" or "by" before it goes with it', () => {
    expect(findDatePhrase('Review notes next friday', TODAY)).toEqual({ day: '2026-11-13', phrase: 'next friday', title: 'Review notes' })
    expect(findDatePhrase('Pay rent by Friday', TODAY)).toEqual({ day: '2026-11-13', phrase: 'Friday', title: 'Pay rent' })
    expect(findDatePhrase('Lunch with Ana on nov 20.', TODAY)).toEqual({ day: '2026-11-20', phrase: 'nov 20.', title: 'Lunch with Ana' })
  })

  test('the last date words in the text are the ones used', () => {
    expect(findDatePhrase('Move the friday review to monday', TODAY)).toEqual({
      day: '2026-11-16',
      phrase: 'monday',
      title: 'Move the friday review to',
    })
  })

  test('a month and day already past this year means next year', () => {
    expect(findDatePhrase('Renew passport jan 5', TODAY)?.day).toBe('2027-01-05')
    expect(findDatePhrase('Renew passport nov 11', TODAY)?.day).toBe('2026-11-11')
  })

  test('text without date words, or that is only date words, has none', () => {
    expect(findDatePhrase('Call Pat', TODAY)).toBeNull()
    expect(findDatePhrase('Buy sunglasses in the market', TODAY)).toBeNull()
    expect(findDatePhrase('Write up yesterday', TODAY)).toBeNull()
    expect(findDatePhrase('tomorrow', TODAY)).toBeNull()
    expect(findDatePhrase('   ', TODAY)).toBeNull()
  })
})
