import { describe, expect, test } from 'vitest'
import type { Row, Sort } from '@/api/types'
import { objectSummary, propertyDef, row, typeDef } from '@/test/mockApi'
import type { FilterCtx } from './filter'
import { SORT_OPTIONS, applySorts } from './sort'

const page = typeDef({
  id: 'page',
  propertyDefinitions: [
    propertyDef({ id: 'title', type: 'entity_title' }),
    propertyDef({ id: 'qty', type: 'number' }),
    propertyDef({ id: 'due', type: 'datetime' }),
    propertyDef({
      id: 'status',
      type: 'label',
      options: {
        set: [
          { id: 'a', text: 'Zeta', color: null, icon: null },
          { id: 'b', text: 'Alpha', color: null, icon: null },
        ],
      },
    }),
  ],
})
const ctx: FilterCtx = { types: [page], collections: [], tagIdsToTitles: {}, now: new Date(2026, 9, 23, 12) }

const R = (path: string, values: Row['values'] = {}, summary: Partial<Row['summary']> = {}): Row =>
  row({ summary: objectSummary({ path, ...summary }), values })
const order = (rows: Row[]) => rows.map((r) => r.summary.path)
const sort = (propertyId: string, option: Sort['option']): Sort => ({ propertyId, option })

describe('sort engine', () => {
  test('sort fallback createdAt newest first', () => {
    const rows = [
      R('old', {}, { createdAt: '2026-01-01T00:00:00Z' }),
      R('none'),
      R('new', {}, { createdAt: '2026-06-01T00:00:00Z' }),
    ]
    expect(order(applySorts(rows, [], ctx))).toEqual(['new', 'old', 'none'])
    // ties on the chosen sort fall back to it as well
    const tied = [R('a', { qty: 1 }, { createdAt: '2026-01-01T00:00:00Z' }), R('b', { qty: 1 }, { createdAt: '2026-06-01T00:00:00Z' })]
    expect(order(applySorts(tied, [sort('qty', 'ascending')], ctx))).toEqual(['b', 'a'])
  })

  test('sort empty last; ascendingExists empty first; descendingExists empty last keeping fallback order', () => {
    const rows = [
      R('e1', {}, { createdAt: '2026-01-01T00:00:00Z' }),
      R('v1', { qty: 3 }, { createdAt: '2026-02-01T00:00:00Z' }),
      R('e2', { qty: null }, { createdAt: '2026-03-01T00:00:00Z' }),
      R('v2', { qty: 1 }, { createdAt: '2026-04-01T00:00:00Z' }),
    ]
    expect(order(applySorts(rows, [sort('qty', 'ascending')], ctx))).toEqual(['v2', 'v1', 'e2', 'e1'])
    expect(order(applySorts(rows, [sort('qty', 'descending')], ctx))).toEqual(['v1', 'v2', 'e2', 'e1'])
    const dated = rows.map((r) => R(r.summary.path, r.values.qty != null ? { due: { start: '2026-10-01', resolution: 'day' } } : {}, r.summary))
    expect(order(applySorts(dated, [sort('due', 'ascendingExists')], ctx))).toEqual(['e2', 'e1', 'v2', 'v1'])
    expect(order(applySorts(dated, [sort('due', 'descendingExists')], ctx))).toEqual(['v2', 'v1', 'e2', 'e1'])
  })

  test('date sort orders by start', () => {
    const rows = [
      R('b', { due: { start: '2026-10-02', resolution: 'day' } }),
      R('a', { due: { start: '2026-10-01', resolution: 'day' } }),
    ]
    expect(order(applySorts(rows, [sort('due', 'ascending')], ctx))).toEqual(['a', 'b'])
    expect(order(applySorts(rows, [sort('due', 'descending')], ctx))).toEqual(['b', 'a'])
  })

  test('label sort follows option order', () => {
    const rows = [R('alpha', { status: ['Alpha'] }), R('zeta', { status: ['Zeta'] })]
    expect(order(applySorts(rows, [sort('status', 'ascending')], ctx))).toEqual(['zeta', 'alpha'])
    expect(order(applySorts(rows, [sort('status', 'descending')], ctx))).toEqual(['alpha', 'zeta'])
  })

  test('numeric-aware title sort', () => {
    const rows = [R('10', {}, { title: 'Item 10' }), R('2', {}, { title: 'Item 2' }), R('x', {}, { title: 'item 3' })]
    expect(order(applySorts(rows, [sort('title', 'ascending')], ctx))).toEqual(['2', 'x', '10'])
    expect(order(applySorts(rows, [sort('title', 'descending')], ctx))).toEqual(['10', 'x', '2'])
  })

  test('sort is stable across several sorts', () => {
    const rows = [R('a', { qty: 1 }, { title: 'B' }), R('b', { qty: 1 }, { title: 'A' }), R('c', { qty: 0 }, { title: 'C' })]
    expect(order(applySorts(rows, [sort('qty', 'ascending'), sort('title', 'ascending')], ctx))).toEqual(['c', 'b', 'a'])
  })

  test('SORT_OPTIONS per kind', () => {
    expect(SORT_OPTIONS('datetime').map((o) => o.label)).toEqual(['Oldest first', 'Newest first', 'is empty first', 'is empty last'])
    expect(SORT_OPTIONS('text').map((o) => o.label)).toEqual(['ascending', 'descending'])
    expect(SORT_OPTIONS('entity_type')).toEqual([])
  })
})
