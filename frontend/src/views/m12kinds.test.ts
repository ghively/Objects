// M12: filters, sorts, groups and column calculations over the formula, rollup, ID, email, phone
// and files kinds (formula and rollup values unwrapped by their result type).
import { describe, expect, test } from 'vitest'
import type { ComputedValue, Filter, PropertyType, Row, Sort } from '@/api/types'
import { objectSummary, propertyDef, row, typeDef } from '@/test/mockApi'
import { CALC_KINDS, calculate } from './calc'
import { FILTER_OPTIONS, computedOperand, filterIsValid, matchFilter, typeMap, withOperator, type FilterCtx } from './filter'
import { GROUP_OPTIONS, groupRows, isGroupable, valueForGroup } from './group'
import { SORT_OPTIONS, applySorts } from './sort'
import { DEFAULT_COL_WIDTH } from './table/tableConfig'

const now = new Date(2026, 10, 5, 12, 0)

const page = typeDef({
  id: 'page',
  propertyDefinitions: [
    propertyDef({ id: 'title', type: 'entity_title' }),
    propertyDef({ id: 'calc', type: 'formula', options: { expression: 'x' } }),
    propertyDef({ id: 'cost', type: 'formula', options: { expression: 'x', numberFormat: { type: 'currency', options: { currency: 'USD', decimals: { min: 2, max: 2 } } } } }),
    propertyDef({ id: 'roll', type: 'rollup', options: { relationId: 'r', targetId: 't', calc: 'percentNotEmpty' } }),
    propertyDef({ id: 'num', type: 'uniqueId', options: { prefix: 'TASK-', nextNumber: 1 } }),
    propertyDef({ id: 'mail', type: 'email' }),
    propertyDef({ id: 'tel', type: 'phone' }),
    propertyDef({ id: 'att', type: 'files', options: { isArray: true } }),
  ],
})
const ctx: FilterCtx = { types: [page], collections: [], tagIdsToTitles: {}, now }

const cv = (type: ComputedValue['type'], value: ComputedValue['value'], error?: string): ComputedValue =>
  error === undefined ? { type, value } : { type, value, error }
const R = (path: string, values: Row['values'] = {}, createdAt?: string): Row =>
  row({ summary: objectSummary({ path, type: 'page', ...(createdAt ? { createdAt } : {}) }), values })
const f = (propertyId: string, option: string, referenceValue?: Filter['referenceValue']): Filter => ({
  type: 'filter',
  propertyId,
  option,
  ...(referenceValue !== undefined ? { referenceValue } : {}),
})
const pass = (rows: Row[], filter: Filter) => rows.filter((r) => matchFilter(r, filter, ctx)).map((r) => r.summary.path)
const order = (rows: Row[]) => rows.map((r) => r.summary.path)

const mixed = [
  R('text', { calc: cv('text', 'Banana') }),
  R('num', { calc: cv('number', 12) }),
  R('day', { calc: cv('date', '2026-11-03') }),
  R('yes', { calc: cv('boolean', true) }),
  R('no', { calc: cv('boolean', false) }),
  R('list', { calc: cv('list', ['Red', 'Blue']) }),
  R('empty', { calc: cv('empty', null) }),
  R('error', { calc: cv('error', null, 'Division by zero') }),
  R('missing'),
]

describe('M12 filters', () => {
  test('operators: computed kinds offer text, number, date and checkbox ones; the rest follow their shape', () => {
    const keys = (k: PropertyType) => FILTER_OPTIONS[k].map((o) => o.key)
    expect(keys('formula')).toEqual([
      'isEmpty',
      'isNotEmpty',
      'contains',
      'notContains',
      'is',
      'isNot',
      'startsWith',
      'endsWith',
      'equal',
      'notEqual',
      'greaterEqual',
      'greater',
      'smallerEqual',
      'smaller',
      'isBefore',
      'isAfter',
      'isOnOrBefore',
      'isOnOrAfter',
      'isChecked',
      'isNotChecked',
    ])
    expect(keys('rollup')).toEqual(keys('formula'))
    expect(new Set(keys('formula')).size).toBe(keys('formula').length)
    expect(keys('email')).toEqual(keys('text'))
    expect(keys('phone')).toEqual(keys('text'))
    expect(keys('uniqueId')).toEqual(keys('text'))
    expect(keys('files')).toEqual(['isEmpty', 'isNotEmpty'])
    expect(filterIsValid(f('calc', 'greater', 3), typeMap([page]))).toBe(true)
    expect(computedOperand('greater')).toBe('number')
    expect(computedOperand('isOnOrAfter')).toBe('date')
    expect(computedOperand('contains')).toBe('text')
    expect(computedOperand('isChecked')).toBe('none')
  })

  test('empty and not empty: empty, error and missing values are empty', () => {
    expect(pass(mixed, f('calc', 'isEmpty'))).toEqual(['empty', 'error', 'missing'])
    expect(pass(mixed, f('calc', 'isNotEmpty'))).toEqual(['text', 'num', 'day', 'yes', 'no', 'list'])
  })

  test('number comparisons match number values only', () => {
    expect(pass(mixed, f('calc', 'greater', 10))).toEqual(['num'])
    expect(pass(mixed, f('calc', 'equal', 12))).toEqual(['num'])
    expect(pass(mixed, f('calc', 'smaller', 10))).toEqual([])
    // Without a value the filter is inactive.
    expect(pass(mixed, f('calc', 'greater'))).toHaveLength(mixed.length)
  })

  test('date comparisons match date values by day', () => {
    expect(pass(mixed, f('calc', 'isBefore', { exactDate: '2026-11-04' }))).toEqual(['day'])
    expect(pass(mixed, f('calc', 'isOnOrAfter', { exactDate: '2026-11-03' }))).toEqual(['day'])
    expect(pass(mixed, f('calc', 'isAfter', { exactDate: '2026-11-03' }))).toEqual([])
    expect(pass([R('inst', { calc: cv('date', '2026-11-03T10:00:00Z') })], f('calc', 'isBefore', { relative: 'today' }))).toEqual(['inst'])
  })

  test('text operators read the value as text; lists by item for is', () => {
    expect(pass(mixed, f('calc', 'contains', 'ban'))).toEqual(['text'])
    expect(pass(mixed, f('calc', 'contains', 'blue'))).toEqual(['list'])
    expect(pass(mixed, f('calc', 'is', 'red'))).toEqual(['list'])
    expect(pass(mixed, f('calc', 'is', '12'))).toEqual(['num'])
    expect(pass(mixed, f('calc', 'startsWith', '2026-11'))).toEqual(['day'])
    expect(pass(mixed, f('calc', 'isNot', 'banana'))).not.toContain('text')
  })

  test('checkbox operators read boolean values', () => {
    expect(pass(mixed, f('calc', 'isChecked'))).toEqual(['yes'])
    expect(pass(mixed, f('calc', 'isNotChecked'))).not.toContain('yes')
  })

  test('email, phone and ID filter as text; files as a list', () => {
    const rows = [
      R('a', { mail: 'ann@example.com', tel: '+1 555 0100', num: 'TASK-12', att: ['Attachments/a.pdf'] }),
      R('b', { mail: null, tel: null, num: null, att: [] }),
    ]
    expect(pass(rows, f('mail', 'contains', 'EXAMPLE'))).toEqual(['a'])
    expect(pass(rows, f('tel', 'startsWith', '+1'))).toEqual(['a'])
    expect(pass(rows, f('num', 'is', 'task-12'))).toEqual(['a'])
    expect(pass(rows, f('mail', 'isEmpty'))).toEqual(['b'])
    expect(pass(rows, f('att', 'isNotEmpty'))).toEqual(['a'])
    expect(pass(rows, f('att', 'isEmpty'))).toEqual(['b'])
  })

  test('changing the operator to another kind of comparison drops the reference', () => {
    const text = f('calc', 'contains', 'x')
    expect(withOperator(text, 'is', 'formula').referenceValue).toBe('x')
    expect(withOperator(text, 'greater', 'formula').referenceValue).toBeUndefined()
    expect(withOperator(f('calc', 'greater', 3), 'smaller', 'rollup').referenceValue).toBe(3)
    // Other kinds keep it, as before.
    expect(withOperator(f('mail', 'contains', 'x'), 'is', 'email').referenceValue).toBe('x')
  })
})

describe('M12 sorts', () => {
  test('formula values: numbers numerically, dates by date, text case-insensitively, empties and errors last', () => {
    const rows = [
      R('err', { calc: cv('error', null, 'x') }),
      R('n10', { calc: cv('number', 10) }),
      R('empty', { calc: cv('empty', null) }),
      R('n9', { calc: cv('number', 9) }),
      R('n100', { calc: cv('number', 100) }),
    ]
    expect(order(applySorts(rows, [{ propertyId: 'calc', option: 'ascending' }], ctx)).slice(0, 3)).toEqual(['n9', 'n10', 'n100'])
    expect(order(applySorts(rows, [{ propertyId: 'calc', option: 'descending' }], ctx)).slice(0, 3)).toEqual(['n100', 'n10', 'n9'])
    expect(order(applySorts(rows, [{ propertyId: 'calc', option: 'ascending' }], ctx)).slice(3).sort()).toEqual(['empty', 'err'])

    const dates = [R('late', { calc: cv('date', '2026-12-01') }), R('early', { calc: cv('date', '2026-01-15T08:00:00Z') })]
    expect(order(applySorts(dates, [{ propertyId: 'calc', option: 'ascending' }], ctx))).toEqual(['early', 'late'])

    const texts = [R('b', { calc: cv('text', 'banana') }), R('A', { calc: cv('text', 'Apple') }), R('c', { calc: cv('text', 'cherry') })]
    expect(order(applySorts(texts, [{ propertyId: 'calc', option: 'ascending' }], ctx))).toEqual(['A', 'b', 'c'])
    expect(SORT_OPTIONS('formula').map((o) => o.key)).toEqual(['ascending', 'descending'])
  })

  test('IDs sort by their trailing number', () => {
    const rows = [R('t10', { num: 'TASK-10' }), R('none', { num: null }), R('t9', { num: 'TASK-9' }), R('t100', { num: 'TASK-100' })]
    const s: Sort[] = [{ propertyId: 'num', option: 'ascending' }]
    expect(order(applySorts(rows, s, ctx))).toEqual(['t9', 't10', 't100', 'none'])
  })

  test('email sorts as text and files by the first file name', () => {
    const rows = [R('z', { mail: 'zed@x.com', att: ['Attachments/b.pdf'] }), R('a', { mail: 'Amy@x.com', att: ['Attachments/a.pdf'] }), R('e', { att: [] })]
    expect(order(applySorts(rows, [{ propertyId: 'mail', option: 'ascending' }], ctx))).toEqual(['a', 'z', 'e'])
    expect(order(applySorts(rows, [{ propertyId: 'att', option: 'descending' }], ctx))).toEqual(['z', 'a', 'e'])
  })
})

describe('M12 groups', () => {
  const by = (propertyId: string) => ({ groups: [{ propertyId, option: 'default' }] })

  test('a formula groups by its value as text, numbers formatted and in numeric order', () => {
    const rows = [
      R('a', { cost: cv('number', 10) }),
      R('b', { cost: cv('number', 9) }),
      R('c', { cost: cv('number', 10) }),
      R('d', { cost: cv('error', null, 'x') }),
      R('e', { cost: cv('empty', null) }),
    ]
    const { groups } = groupRows(rows, by('cost'), undefined, ctx)
    expect(groups.map((g) => g.label)).toEqual(['$9.00', '$10.00', 'Other'])
    expect(groups[1].rows.map((r) => r.summary.path)).toEqual(['a', 'c'])
    expect(groups[2].rows.map((r) => r.summary.path)).toEqual(['d', 'e'])
  })

  test('booleans, dates and list items', () => {
    const rows = [
      R('y', { calc: cv('boolean', true) }),
      R('l', { calc: cv('list', ['Red', 'Blue']) }),
      R('d', { calc: cv('date', '2026-10-30') }),
      R('t', { calc: cv('text', 'Red') }),
    ]
    const { groups } = groupRows(rows, by('calc'), undefined, ctx)
    const labels = groups.map((g) => g.label)
    expect(labels).toEqual(expect.arrayContaining(['Checked', 'Red', 'Blue', 'Oct 30, 2026']))
    expect(groups.find((g) => g.label === 'Red')!.rows.map((r) => r.summary.path)).toEqual(['l', 't'])
  })

  test('computed, ID and files values are never written by a drop; files are not grouped by', () => {
    const group = { id: 'text:12', label: '12', rows: [] }
    for (const k of ['formula', 'rollup', 'uniqueId', 'files'] as const) {
      expect(valueForGroup({ propertyId: 'x', option: 'default' }, group, { type: k, options: {} })).toBeNull()
    }
    expect(valueForGroup({ propertyId: 'mail', option: 'default' }, { id: 'text:a@b', label: 'a@b', rows: [] }, { type: 'email', options: {} })).toEqual({
      key: 'mail',
      value: 'a@b',
    })
    expect(isGroupable('files')).toBe(false)
    expect(isGroupable('formula')).toBe(true)
    expect(GROUP_OPTIONS('rollup').map((o) => o.key)).toEqual(['default'])
  })
})

describe('M12 calculations', () => {
  test('menus: computed kinds count, sum and date; ID, email, phone and files count', () => {
    expect(CALC_KINDS('formula')).toEqual(expect.arrayContaining(['countAll', 'countNotEmpty', 'sum', 'average', 'median', 'min', 'max', 'range', 'earliestDate', 'latestDate', 'dateRange']))
    expect(CALC_KINDS('rollup')).toEqual(CALC_KINDS('formula'))
    for (const k of ['uniqueId', 'email', 'phone', 'files'] as const) expect(CALC_KINDS(k)).toEqual(CALC_KINDS('text'))
  })

  test('number calculations use the number values, in the formula number format', () => {
    const rows = [R('a', { cost: cv('number', 2) }), R('b', { cost: cv('number', 4.5) }), R('c', { cost: cv('text', 'n/a') }), R('d', { cost: cv('error', null, 'x') })]
    expect(calculate(rows, 'cost', 'sum', ctx)).toEqual({ value: 6.5, display: '$6.50' })
    expect(calculate(rows, 'cost', 'average', ctx).value).toBe(3.25)
    expect(calculate(rows, 'cost', 'countNotEmpty', ctx).value).toBe(3)
    expect(calculate(rows, 'cost', 'countEmpty', ctx).value).toBe(1)
    expect(calculate(rows, 'cost', 'earliestDate', ctx)).toEqual({ value: null, display: '' })
  })

  test("a percent rollup's sum shows as a percentage", () => {
    const rows = [R('a', { roll: cv('number', 0.25) }), R('b', { roll: cv('number', 0.5) })]
    expect(calculate(rows, 'roll', 'sum', ctx).display).toBe('75%')
  })

  test('date calculations use the date values', () => {
    const rows = [R('a', { calc: cv('date', '2026-11-01') }), R('b', { calc: cv('date', '2026-11-04') }), R('c', { calc: cv('number', 7) })]
    expect(calculate(rows, 'calc', 'earliestDate', ctx).display).toBe('Nov 1, 2026')
    expect(calculate(rows, 'calc', 'latestDate', ctx).display).toBe('Nov 4, 2026')
    expect(calculate(rows, 'calc', 'dateRange', ctx).display).toBe('3 days')
    expect(calculate(rows, 'calc', 'sum', ctx).value).toBe(7)
  })

  test('list values count per item; files count files', () => {
    const rows = [R('a', { calc: cv('list', ['x', 'y']), att: ['Attachments/a.pdf', 'Attachments/b.pdf'] }), R('b', { calc: cv('list', ['x']), att: [] })]
    expect(calculate(rows, 'calc', 'countValues', ctx).value).toBe(3)
    expect(calculate(rows, 'calc', 'countUnique', ctx).value).toBe(2)
    expect(calculate(rows, 'att', 'countValues', ctx).value).toBe(2)
    expect(calculate(rows, 'att', 'percentEmpty', ctx).display).toBe('50%')
  })

  test('IDs, emails and phones count as text', () => {
    const rows = [R('a', { num: 'TASK-1', mail: 'a@b', tel: '555 0100' }), R('b', { num: 'TASK-2', mail: 'a@b', tel: null })]
    expect(calculate(rows, 'num', 'countUnique', ctx).value).toBe(2)
    expect(calculate(rows, 'mail', 'countUnique', ctx).value).toBe(1)
    expect(calculate(rows, 'tel', 'countEmpty', ctx).value).toBe(1)
  })
})

describe('M12 table', () => {
  test('default column widths for the new kinds', () => {
    for (const k of ['formula', 'rollup', 'uniqueId', 'email', 'phone', 'files'] as const) expect(DEFAULT_COL_WIDTH[k]).toBeGreaterThan(0)
  })
})
