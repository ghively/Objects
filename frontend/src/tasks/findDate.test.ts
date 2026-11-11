import { describe, expect, test } from 'vitest'
import { findDatePhrase } from './findDate'

// Wednesday.
const TODAY = '2026-11-11'

describe('findDatePhrase', () => {
  test('test date words anywhere in the text are found and taken out of the title', () => {
    expect(findDatePhrase('Call Pat friday', TODAY)).toEqual({ day: '2026-11-13', phrase: 'friday', title: 'Call Pat' })
    expect(findDatePhrase('tomorrow call Pat', TODAY)).toEqual({ day: '2026-11-12', phrase: 'tomorrow', title: 'call Pat' })
    expect(findDatePhrase('Send the report draft nov 20', TODAY)).toEqual({ day: '2026-11-20', phrase: 'nov 20', title: 'Send the report draft' })
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

  // The M32 review, F3: everyday words were read as dates and cut out of the title ("Buy sun
  // cream" became "Buy cream" on Sunday). A shortened weekday and a bare month and day are date
  // words only as the last words of the text, or right after "on", "by", "due" or "next".
  describe('words that are also everyday words', () => {
    test.each(['Buy sun cream', 'Sat nav update', 'Chapter 3 may need a rewrite', 'Wed the plants to the pots', 'Send the nov 20 report draft', 'Mon cheri chocolates for Ana'])(
      'test "%s" has no date',
      (text) => {
        expect(findDatePhrase(text, TODAY)).toBeNull()
      },
    )

    test.each(['Call May', '2nd draft', 'March for the planet', 'Sun', 'may 3'])('test "%s" has no date (as before)', (text) => {
      expect(findDatePhrase(text, TODAY)).toBeNull()
    })

    test('test a shortened weekday is a date as the last word, or after "on", "by", "due" or "next"', () => {
      expect(findDatePhrase('Pay rent fri', TODAY)).toEqual({ day: '2026-11-13', phrase: 'fri', title: 'Pay rent' })
      expect(findDatePhrase('Buy sun cream sat.', TODAY)).toEqual({ day: '2026-11-14', phrase: 'sat.', title: 'Buy sun cream' })
      expect(findDatePhrase('Lunch on sat with Ana', TODAY)).toEqual({ day: '2026-11-14', phrase: 'sat', title: 'Lunch with Ana' })
      expect(findDatePhrase('Report due mon at the latest', TODAY)).toEqual({ day: '2026-11-16', phrase: 'mon', title: 'Report at the latest' })
      expect(findDatePhrase('Review next wed with Ana', TODAY)).toEqual({ day: '2026-11-18', phrase: 'next wed', title: 'Review with Ana' })
    })

    test('test a month and day are a date as the last words, or after "on", "by" or "due"', () => {
      expect(findDatePhrase('Dentist on 3 may', TODAY)).toEqual({ day: '2027-05-03', phrase: '3 may', title: 'Dentist' })
      expect(findDatePhrase('Chapter 3 may need a rewrite by may 3', TODAY)).toEqual({ day: '2027-05-03', phrase: 'may 3', title: 'Chapter 3 may need a rewrite' })
      expect(findDatePhrase('Send by nov 20 the report draft', TODAY)).toEqual({ day: '2026-11-20', phrase: 'nov 20', title: 'Send the report draft' })
    })

    test('test a full weekday name, "today", "tomorrow", "next week", "in N days" and a written date are read anywhere', () => {
      expect(findDatePhrase('Call the bank friday', TODAY)).toEqual({ day: '2026-11-13', phrase: 'friday', title: 'Call the bank' })
      // A known false positive: the chip shows, and Backspace or its × gives the words back.
      expect(findDatePhrase('Read Friday Night Lights', TODAY)).toEqual({ day: '2026-11-13', phrase: 'Friday', title: 'Read Night Lights' })
      expect(findDatePhrase('Call Pat today about the car', TODAY)?.title).toBe('Call Pat about the car')
      expect(findDatePhrase('Plan next week with Ana', TODAY)).toEqual({ day: '2026-11-18', phrase: 'next week', title: 'Plan with Ana' })
      expect(findDatePhrase('Check in 3 days if it shipped', TODAY)).toEqual({ day: '2026-11-14', phrase: 'in 3 days', title: 'Check if it shipped' })
      expect(findDatePhrase('Renew passport 2026-12-01', TODAY)).toEqual({ day: '2026-12-01', phrase: '2026-12-01', title: 'Renew passport' })
      expect(findDatePhrase('Renew 2026-12-01 the passport', TODAY)?.title).toBe('Renew the passport')
    })

    test('test a "for" before the date words goes with them', () => {
      expect(findDatePhrase('Plan for tomorrow', TODAY)).toEqual({ day: '2026-11-12', phrase: 'tomorrow', title: 'Plan' })
      expect(findDatePhrase('Slides for friday', TODAY)).toEqual({ day: '2026-11-13', phrase: 'friday', title: 'Slides' })
      // "for" does not make a shortened word a date: "sat" here is not the last word.
      expect(findDatePhrase('Maps for sat nav', TODAY)).toBeNull()
    })
  })
})
