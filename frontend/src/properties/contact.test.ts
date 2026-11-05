import { describe, expect, it } from 'vitest'
import { isValidPhone } from './contact'

describe('isValidPhone', () => {
  it('accepts what the server accepts', () => {
    expect(isValidPhone('+1 (555) 010-0.1')).toBe(true)
    expect(isValidPhone('12')).toBe(false)
    expect(isValidPhone('555 x12')).toBe(false)
  })

  it('refuses tabs and line breaks, like the server (spaces only)', () => {
    expect(isValidPhone('555\t0100')).toBe(false)
    expect(isValidPhone('555\n0100')).toBe(false)
    expect(isValidPhone('555 0100')).toBe(false)
  })
})
