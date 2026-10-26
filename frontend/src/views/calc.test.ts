import { describe, expect, test } from 'vitest'
import type { Row } from '@/api/types'
import { objectSummary, propertyDef, row, typeDef } from '@/test/mockApi'
import { CALC_KINDS, CALC_LABELS, calculate } from './calc'
import type { FilterCtx } from './filter'

const page = typeDef({
  id: 'page',
  propertyDefinitions: [
    propertyDef({ id: 'title', type: 'entity_title' }),
    propertyDef({ id: 'qty', type: 'number', options: { numberFormat: { type: 'number', options: { decimals: { min: 0, max: 2 } } } } }),
    propertyDef({ id: 'when', type: 'datetime' }),
    propertyDef({ id: 'flavor', type: 'label', options: { set: [] } }),
    propertyDef({ id: 'done', type: 'boolean' }),
  ],
})
const ctx: FilterCtx = { types: [page], collections: [], tagIdsToTitles: {}, now: new Date(2026, 9, 23) }
const R = (values: Row['values']): Row => row({ summary: objectSummary({ path: 'x.md', type: 'page' }), values })

describe('calculations', () => {
  test('countValues sums multi-value cells', () => {
    const rows = [R({ flavor: ['A', 'B'] }), R({ flavor: ['A'] }), R({ flavor: [] })]
    expect(calculate(rows, 'flavor', 'countValues', ctx).value).toBe(3)
    expect(calculate(rows, 'flavor', 'countUnique', ctx).value).toBe(2)
    expect(calculate(rows, 'flavor', 'percentEmpty', ctx).display).toBe('33.3%')
    expect(calculate(rows, 'flavor', 'countAll', ctx).display).toBe('3')
    expect(calculate(rows, 'flavor', 'percentNotEmpty', ctx).display).toBe('66.7%')
  })

  test('median and date range duration', () => {
    const nums = [1, 3, 10, 20].map((n) => R({ qty: n }))
    expect(calculate(nums, 'qty', 'median', ctx)).toEqual({ value: 6.5, display: '6.5' })
    expect(calculate(nums, 'qty', 'sum', ctx).display).toBe('34')
    expect(calculate(nums, 'qty', 'range', ctx).display).toBe('19')
    const dates = [R({ when: { start: '2026-01-01', resolution: 'day' } }), R({ when: { start: '2026-03-15', resolution: 'day' } })]
    expect(calculate(dates, 'when', 'dateRange', ctx).display).toBe('2 months')
    expect(calculate(dates, 'when', 'earliestDate', ctx).display).toBe('Jan 1, 2026')
  })

  test('single unit is singular', () => {
    const dates = [R({ when: { start: '2026-01-01', resolution: 'day' } }), R({ when: { start: '2026-01-02', resolution: 'day' } })]
    expect(calculate(dates, 'when', 'dateRange', ctx).display).toBe('1 day')
  })

  test('boolean calc kinds limited to five', () => {
    expect(CALC_KINDS('boolean')).toEqual(['countAll', 'checked', 'unchecked', 'percentChecked', 'percentUnchecked'])
    const rows = [R({ done: true }), R({ done: false }), R({})]
    expect(calculate(rows, 'done', 'checked', ctx).value).toBe(1)
    expect(calculate(rows, 'done', 'percentChecked', ctx).display).toBe('33.3%')
  })

  test('kinds and labels', () => {
    expect(CALC_KINDS('blocks')).toEqual([])
    expect(CALC_KINDS('number')).toContain('median')
    expect(CALC_KINDS('datetime')).toContain('dateRange')
    expect(CALC_LABELS.full.countUnique).toBe('Count unique values')
    expect(CALC_LABELS.short.countUnique).toBe('Unique')
  })

  test('empty numeric input yields no value', () => {
    expect(calculate([R({})], 'qty', 'sum', ctx)).toEqual({ value: null, display: '' })
  })
})
