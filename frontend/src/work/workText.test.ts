import { describe, expect, test } from 'vitest'
import { WORK_TEXT } from './workText'

describe('WORK_TEXT plurals', () => {
  test('day counts say "1 day", not "1 days"', () => {
    expect(WORK_TEXT.lastTouchedDays(1)).toBe('Last touched 1 day ago')
    expect(WORK_TEXT.lastTouchedDays(3)).toBe('Last touched 3 days ago')
    expect(WORK_TEXT.daysLeft(1)).toBe('1 day')
    expect(WORK_TEXT.daysLeft(0)).toBe('0 days')
    expect(WORK_TEXT.daysLeft(7)).toBe('7 days')
    expect(WORK_TEXT.daysQuiet(1)).toBe('1 day quiet')
    expect(WORK_TEXT.daysQuiet(11)).toBe('11 days quiet')
  })
})
