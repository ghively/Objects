import { describe, expect, test } from 'vitest'
import { escapeHtml } from './escapeHtml'

describe('escapeHtml', () => {
  test('escapes the five markup characters as numeric character references', () => {
    expect(escapeHtml('a<b>c&d"e\'f')).toBe('a&#60;b&#62;c&#38;d&#34;e&#39;f')
  })

  test('leaves other text alone', () => {
    expect(escapeHtml('plain text 123 àé')).toBe('plain text 123 àé')
    expect(escapeHtml('')).toBe('')
  })
})
