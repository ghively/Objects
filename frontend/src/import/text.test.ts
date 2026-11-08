import { describe, expect, test } from 'vitest'
import { IMPORT_TEXT } from './text'

describe('IMPORT_TEXT plurals', () => {
  test('the preview summary counts one of each in the singular', () => {
    expect(IMPORT_TEXT.summary(1, 1, 1)).toBe('1 object, 1 type, 1 attachment')
    expect(IMPORT_TEXT.summary(12, 2, 4)).toBe('12 objects, 2 types, 4 attachments')
    expect(IMPORT_TEXT.summary(0, 0, 0)).toBe('0 objects, 0 types, 0 attachments')
  })
})
