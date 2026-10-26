import { describe, expect, test } from 'vitest'
import type { Row, TypeDef } from '@/api/types'
import { collection, objectSummary, propertyDef, row, typeDef } from '@/test/mockApi'
import { GROUP_OPTIONS, GROUP_SORT_OPTIONS, groupRows, valueForGroup, type GroupCtx } from './group'

const now = new Date(2026, 9, 23, 12, 0) // Friday

const opts = (...texts: string[]) => texts.map((t, i) => ({ id: `o${i + 1}`, text: t, color: null, icon: null }))
const status = propertyDef({ id: 'status', type: 'label', options: { isStatus: true, set: opts('Todo', 'Doing', 'Done') } })
const flavor = propertyDef({ id: 'flavor', type: 'label', options: { set: opts('Sweet', 'Sour') } })
const page = typeDef({
  id: 'page',
  propertyDefinitions: [
    propertyDef({ id: 'title', type: 'entity_title' }),
    status,
    flavor,
    propertyDef({ id: 'done', type: 'boolean' }),
    propertyDef({ id: 'qty', type: 'number' }),
    propertyDef({ id: 'due', type: 'datetime' }),
    propertyDef({ id: 'owner', type: 'entity' }),
    propertyDef({ id: 'note', type: 'text' }),
  ],
})
const types: TypeDef[] = [page]
const ctx = (extra: Partial<GroupCtx> = {}): GroupCtx => ({ types, collections: [], tagIdsToTitles: {}, now, ...extra })

const R = (path: string, values: Row['values'] = {}, summary: Partial<Row['summary']> = {}): Row =>
  row({ summary: objectSummary({ path, type: 'page', ...summary }), values })
const by = (propertyId: string, option = 'default', extra: Record<string, unknown> = {}) => ({
  groups: [{ propertyId, option, ...extra }],
})
const ids = (gs: { id: string }[]) => gs.map((g) => g.id)
const labels = (gs: { label: string }[]) => gs.map((g) => g.label)
const paths = (r: Row[]) => r.map((x) => x.summary.path)

describe('group options', () => {
  test('options per kind', () => {
    expect(GROUP_OPTIONS('textBlock').map((o) => o.label)).toEqual(['By Text', 'By Linked Objects'])
    expect(GROUP_OPTIONS('number').map((o) => o.label)).toEqual(['By Exact Value', 'By Range'])
    expect(GROUP_OPTIONS('datetime').map((o) => o.label)).toEqual(['By Hour', 'By Day', 'By Week', 'By Month', 'By Year', 'Relative'])
    expect(GROUP_OPTIONS('label').map((o) => o.key)).toEqual(['default'])
    expect(GROUP_SORT_OPTIONS('label').slice(0, 2).map((o) => o.label)).toEqual(['Order', 'Order inverse'])
    expect(GROUP_SORT_OPTIONS('entity').map((o) => o.label)).toContain('Created newest first')
    expect(GROUP_SORT_OPTIONS('text').at(-1)?.label).toBe('Manual')
  })
})

describe('groupRows', () => {
  test('label groups in option order with Other last', () => {
    const rows = [R('a', { flavor: ['Sour'] }), R('b', { flavor: ['Sweet'] }), R('c', {})]
    const { groups } = groupRows(rows, by('flavor'), undefined, ctx())
    expect(labels(groups)).toEqual(['Sweet', 'Sour', 'Other'])
    expect(groups[2].isOther).toBe(true)
    expect(paths(groups[0].rows)).toEqual(['b'])
  })

  test('Other group last except status first', () => {
    const rows = [R('a', { status: ['Done'] }), R('b', {})]
    const { groups } = groupRows(rows, by('status'), undefined, ctx())
    expect(labels(groups)).toEqual(['Other', 'Todo', 'Doing', 'Done'])
  })

  test('multi-value entity row appears in each group', () => {
    const rows = [
      R('a', { owner: [{ target: 'Ann', path: 'Pages/Ann.md' }, { target: 'Bob', path: 'Pages/Bob.md' }] }),
      R('b', { owner: [{ target: 'Ann', path: 'Pages/Ann.md' }] }),
    ]
    const { groups } = groupRows(rows, by('owner'), undefined, ctx({ entityTitles: { 'Pages/Ann.md': 'Ann Lee' } }))
    expect(labels(groups)).toEqual(['Ann Lee', 'Bob'])
    expect(paths(groups[0].rows)).toEqual(['a', 'b'])
    expect(paths(groups[1].rows)).toEqual(['a'])
  })

  test('boolean groups labelled Checked and Unchecked', () => {
    const { groups } = groupRows([R('a', { done: true }), R('b', {})], by('done'), undefined, ctx())
    expect(ids(groups)).toEqual(['true', 'false'])
    expect(labels(groups)).toEqual(['Checked', 'Unchecked'])
  })

  test('number range groups drop out-of-range', () => {
    const rows = [R('a', { qty: 1 }), R('b', { qty: 7 }), R('c', { qty: 12 }), R('d', { qty: 10 })]
    const { groups } = groupRows(rows, by('qty', 'range', { numberRangeConfig: { min: 0, max: 10, step: 5 } }), undefined, ctx())
    expect(labels(groups)).toEqual(['0–5', '5–10'])
    expect(paths(groups[1].rows)).toEqual(['b', 'd'])
    expect(groups.flatMap((g) => paths(g.rows))).not.toContain('c')
  })

  test('date Relative buckets against fixed now', () => {
    const d = (day: number) => ({ start: `2026-10-${String(day).padStart(2, '0')}`, resolution: 'day' })
    const rows = [R('today', { due: d(23) }), R('yest', { due: d(22) }), R('tom', { due: d(24) }), R('lastw', { due: d(15) }), R('nextw', { due: d(28) }), R('old', { due: d(1) }), R('none', {})]
    const { groups } = groupRows(rows, by('due', 'relative'), undefined, ctx())
    expect(labels(groups)).toEqual(['Earlier', 'Last week', 'Yesterday', 'Today', 'Tomorrow', 'Next week', 'Other'])
  })

  test('hideEmptyGroups drops empty label options', () => {
    const { groups } = groupRows([R('a', { flavor: ['Sour'] })], by('flavor'), { groups: [], hideEmptyGroups: true }, ctx())
    expect(labels(groups)).toEqual(['Sour'])
  })

  test('hideByDefault hides unknown groups', () => {
    const cfg = { groups: [{ id: 'o1', isHidden: false, isClosed: true }], hideByDefault: true }
    const { groups, hidden } = groupRows([R('a', { flavor: ['Sour'] })], by('flavor'), cfg, ctx())
    expect(ids(groups)).toEqual(['o1'])
    expect(ids(hidden)).toEqual(['o2'])
  })

  test('manual group order', () => {
    const cfg = { groups: ['o2', 'o1'].map((id) => ({ id, isHidden: false, isClosed: false })) }
    const { groups } = groupRows([R('a', {})], { ...by('flavor'), sortOption: 'manual' }, cfg, ctx())
    expect(ids(groups)).toEqual(['o2', 'o1', 'other'])
  })

  test('sizeDescending orders by count', () => {
    const rows = [R('a', { note: 'x' }), R('b', { note: 'y' }), R('c', { note: 'y' })]
    const { groups } = groupRows(rows, { ...by('note'), sortOption: 'sizeDescending' }, undefined, ctx())
    expect(labels(groups)).toEqual(['y', 'x'])
  })

  test('text groups cut at 500 characters', () => {
    const { groups } = groupRows([R('a', { note: 'z'.repeat(600) })], by('note'), undefined, ctx())
    expect(groups[0].label).toHaveLength(500)
  })
})

describe('valueForGroup', () => {
  test('label gives option text and null for createdAt', () => {
    const { groups } = groupRows([R('a', {})], by('status'), undefined, ctx())
    const doing = groups.find((g) => g.label === 'Doing')!
    expect(valueForGroup(by('status'), doing, status)).toEqual({ key: 'status', value: ['Doing'] })
    expect(valueForGroup(by('status'), groups[0], status)).toEqual({ key: 'status', value: [] })
    expect(valueForGroup(by('createdAt'), doing, { type: 'entity_createdAt', options: {} })).toBeNull()
    expect(valueForGroup(by('qty', 'range'), doing, { type: 'number', options: {} })).toBeNull()
    expect(valueForGroup(by('due', 'day'), doing, { type: 'datetime', options: {} })).toBeNull()
  })

  test('collection ids resolve in groups', () => {
    const c = collection({ id: 'tools', name: 'Tooling' })
    const { groups } = groupRows([R('a', {}, { collections: ['tooling'] })], by('collections'), undefined, ctx({ collections: [c] }))
    expect(ids(groups)).toEqual(['tools'])
  })
})
