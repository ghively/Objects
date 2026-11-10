import { describe, expect, test } from 'vitest'
import { counterpartKey } from './counterpartKey'

describe('counterpartKey', () => {
  test('test a name makes a camel-case key, numbered past a taken one', () => {
    expect(counterpartKey('Used by', new Set())).toBe('usedBy')
    expect(counterpartKey('Documented in', new Set(['documentedIn']))).toBe('documentedIn2')
  })

  test("test the server's reserved keys are never chosen (M28 review #7)", () => {
    // backend typemodel.py `_COUNTERPART_RESERVED`: typedefs.SYSTEM_KEYS plus backlinks and the rest.
    expect(counterpartKey('Source', new Set())).toBe('source2')
    expect(counterpartKey('Date', new Set())).toBe('date2')
    expect(counterpartKey('URL', new Set())).toBe('url2')
    expect(counterpartKey('Import source', new Set())).toBe('importSource2')
    expect(counterpartKey('Hide properties', new Set())).toBe('hideProperties2')
    expect(counterpartKey('Backlinks', new Set())).toBe('backlinks2')
  })
})
