import { describe, expect, it } from 'vitest'
import { requestBodyFocus, takeBodyFocus } from './focusRequest'

describe('focusRequest (M32 contract)', () => {
  it('hands a request over once', () => {
    requestBodyFocus('Daily/2026-11-11.md', 'end')
    expect(takeBodyFocus('Daily/2026-11-11.md')).toBe('end')
    expect(takeBodyFocus('Daily/2026-11-11.md')).toBeNull()
  })
  it('keeps requests apart by path', () => {
    requestBodyFocus('a.md', 'start')
    expect(takeBodyFocus('b.md')).toBeNull()
    expect(takeBodyFocus('a.md')).toBe('start')
  })
})
