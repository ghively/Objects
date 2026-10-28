import { describe, expect, test } from 'vitest'
import { cpToUtf16 } from './codepoints'

describe('cpToUtf16', () => {
  test('maps code-point offsets to UTF-16 indexes', () => {
    expect(cpToUtf16('abc', 2)).toBe(2)
    expect(cpToUtf16('🚀 Launch', 0)).toBe(0)
    expect(cpToUtf16('🚀 Launch', 1)).toBe(2)
    expect(cpToUtf16('🚀 Launch', 2)).toBe(3)
    expect(cpToUtf16('a🚀b🚀c', 4)).toBe(6)
    expect(cpToUtf16('ab', -1)).toBe(0)
    expect(cpToUtf16('a🚀', 5)).toBe(6)
  })
})
