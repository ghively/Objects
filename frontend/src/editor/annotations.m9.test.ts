import { describe, expect, test } from 'vitest'
import { formatAnnotation, formatOption, isKnownValue, knownOption, makeOption, parseAnnotation } from './annotations'

const INFO = JSON.stringify({
  viewDefinition: { dataViewLayout: 'wall' },
  filterGroup: {
    type: 'filterGroup',
    operator: 'and',
    elements: [{ type: 'filter', propertyId: 'title', option: 'contains', referenceValue: 'say "hi" --> a\\b' }],
  },
  sorts: [{ propertyId: 'title', option: 'descending' }],
  groupBy: null,
})

describe('localDataViewInfo option (M9)', () => {
  test('is a known, quoted option of embedded views only', () => {
    const known = knownOption('localDataViewInfo')
    expect(known?.appliesTo).toEqual(['dataView'])
    expect(known?.quoted).toBe(true)
    expect(isKnownValue({ key: 'localDataViewInfo', value: INFO })).toBe(true)
    expect(isKnownValue({ key: 'localDataViewInfo', value: 'nope' })).toBe(false)
  })

  test('test value with quotes and --> survives', () => {
    const text = formatOption({ key: 'localDataViewInfo', value: INFO })
    expect(text.startsWith('localDataViewInfo="{\\"viewDefinition\\":')).toBe(true)
    // One line, and no `-->` that would end the comment early.
    expect(text).not.toMatch(/[\r\n]/)
    expect(text).not.toContain('-->')
    const line = `<!-- block: ${text} -->`
    const parsed = parseAnnotation(line)
    expect(parsed?.options).toEqual([{ key: 'localDataViewInfo', value: INFO, raw: text }])
    expect(JSON.parse(parsed!.options[0].value as string)).toEqual(JSON.parse(INFO))
    expect(formatAnnotation(parsed!)).toBe(line)
  })

  test('test details flag and localDataViewInfo coexist', () => {
    const line = formatAnnotation({ type: 'leaf', options: [makeOption('localDataViewInfo', INFO), makeOption('details', true)] })
    expect(line.startsWith('<!-- block: details localDataViewInfo="')).toBe(true)
    const parsed = parseAnnotation(line + '\r\n')
    expect(parsed?.options.map((o) => o.key)).toEqual(['details', 'localDataViewInfo'])
    expect(parsed?.options[1].value).toBe(INFO)
  })
})
