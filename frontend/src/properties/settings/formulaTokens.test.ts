import { describe, expect, test } from 'vitest'
import { formulaPropertyNames, propCall } from './formulaFunctions'
import { tokenizeFormula } from './formulaTokens'
import { propertyDef } from '@/test/mockApi'

describe('tokenizeFormula', () => {
  test('every character lands in a token', () => {
    const src = 'if(prop("Done") and x.length() > 2, "a \\" b" + 1.5, round(-3 % 2)) // ?'
    expect(
      tokenizeFormula(src)
        .map((t) => t.text)
        .join(''),
    ).toBe(src)
  })

  test('kinds: functions, prop, strings, numbers, keywords, operators', () => {
    const kinds = tokenizeFormula('round(prop("Price") * 1.5, 2) >= 3 and not true')
      .filter((t) => t.kind !== 'space')
      .map((t) => `${t.kind}:${t.text}`)
    expect(kinds).toEqual([
      'function:round',
      'punctuation:(',
      'prop:prop',
      'punctuation:(',
      'string:"Price"',
      'punctuation:)',
      'operator:*',
      'number:1.5',
      'punctuation:,',
      'number:2',
      'punctuation:)',
      'operator:>=',
      'number:3',
      'keyword:and',
      'keyword:not',
      'keyword:true',
    ])
  })

  test('an unterminated string runs to the end', () => {
    expect(tokenizeFormula('"abc')).toEqual([{ kind: 'string', text: '"abc' }])
  })

  test('a method call is a function; a bare unknown name is not', () => {
    const t = tokenizeFormula('x.upper()')
    expect(t.map((k) => k.kind)).toEqual(['other', 'punctuation', 'function', 'punctuation', 'punctuation'])
  })
})

describe('formula property names', () => {
  test('system names first, then readable properties, without itself or content', () => {
    const defs = [
      propertyDef({ id: 'title', name: 'Title', type: 'entity_title' }),
      propertyDef({ id: 'p1', name: 'Price', type: 'number' }),
      propertyDef({ id: 'self', name: 'Total', type: 'formula' }),
      propertyDef({ id: 'body', name: 'Body', type: 'blocks' }),
      propertyDef({ id: 'p2', name: 'Status', type: 'label' }),
    ]
    expect(formulaPropertyNames(defs, 'self')).toEqual([
      'Title',
      'Description',
      'Tags',
      'Created at',
      'Last updated',
      'Aliases',
      'Price',
      'Status',
    ])
  })

  test('propCall escapes quotes and backslashes', () => {
    expect(propCall('Say "hi" \\ there')).toBe('prop("Say \\"hi\\" \\\\ there")')
  })
})
