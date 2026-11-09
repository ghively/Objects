import { describe, expect, test } from 'vitest'
import { IMPORT_TEXT } from './text'

describe('IMPORT_TEXT plurals', () => {
  test('the preview summary counts one of each in the singular', () => {
    expect(IMPORT_TEXT.summary(1, 1, 1)).toBe('1 object, 1 type, 1 attachment')
    expect(IMPORT_TEXT.summary(12, 2, 4)).toBe('12 objects, 2 types, 4 attachments')
    expect(IMPORT_TEXT.summary(0, 0, 0)).toBe('0 objects, 0 types, 0 attachments')
  })

  test('a stopped import says the failed were not written because it stopped, as the report does (fix pass H)', () => {
    const r = { sourceItems: 17, objects: 4, updated: 0, unchanged: 0, changedInBoth: 0, leftOut: 0, failed: 13 }
    expect(IMPORT_TEXT.accountedFor({ ...r, notWritten: 13 })).toBe(
      '17 source items: 4 imported, 0 updated, 0 unchanged, 0 changed in both, 0 left out, 13 failed (13 not written because the import stopped)',
    )
    expect(IMPORT_TEXT.accountedFor(r)).toMatch(/13 failed$/)
  })
})
