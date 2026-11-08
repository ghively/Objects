import { describe, expect, test, vi } from 'vitest'

// The calculations run per chart cell: counted to check empty cells cost none.
vi.mock('../../calc', async (orig) => {
  const real = await orig<typeof import('../../calc')>()
  return { ...real, calculate: vi.fn(real.calculate) }
})
import type { ChartViewConfig, Row, TypeDef, ViewState } from '@/api/types'
import { objectSummary, propertyDef, row, typeDef } from '@/test/mockApi'
import { calculate } from '../../calc'
import { applyFilters, filterIsValid, typeMap } from '../../filter'
import type { GroupCtx } from '../../group'
import { emptyFilterGroup } from '../../model'
import {
  DEFAULT_CHART_CONFIG,
  addFilters,
  axisChoices,
  buildChartData,
  chartConfigOf,
  fillDateGaps,
  filtersForGroup,
  numberValue,
  resolveX,
  tableStateFor,
  withChartConfig,
} from './chartData'
import { niceScale, shortNumber, truncate } from './scale'

const opts = (...texts: [string, string | null][]) => texts.map(([t, color], i) => ({ id: `o${i + 1}`, text: t, color, icon: null }))
const status = propertyDef({ id: 'status', type: 'label', options: { set: opts(['Todo', 'red'], ['Doing', 'amber'], ['Done', 'green']) } })
const task = typeDef({
  id: 'task',
  propertyDefinitions: [
    propertyDef({ id: 'title', type: 'entity_title' }),
    status,
    propertyDef({ id: 'size', type: 'label', options: { set: opts(['S', null], ['L', null]) } }),
    propertyDef({ id: 'done', type: 'boolean' }),
    propertyDef({ id: 'points', type: 'number', name: 'Points' }),
    propertyDef({ id: 'due', type: 'datetime', name: 'Due' }),
    propertyDef({ id: 'owner', type: 'entity' }),
    propertyDef({ id: 'note', type: 'text' }),
  ],
})
const plain = typeDef({ id: 'plain', propertyDefinitions: [propertyDef({ id: 'title', type: 'entity_title' }), propertyDef({ id: 'note', type: 'text' })] })
const types: TypeDef[] = [task, plain]
const ctx = (extra: Partial<GroupCtx> = {}): GroupCtx => ({
  types,
  viewTypeIds: ['task'],
  collections: [],
  tagIdsToTitles: { tagA: 'alpha' },
  pathsById: { idAnn: 'People/Ann.md' },
  entityTitles: { 'People/Ann.md': 'Ann' },
  now: new Date(2026, 9, 23, 12, 0),
  ...extra,
})

const day = (s: string) => ({ start: s, resolution: 'day' as const })
const R = (n: number, values: Row['values'] = {}, summary: Partial<Row['summary']> = {}): Row =>
  row({ summary: objectSummary({ path: `Tasks/T${n}.md`, type: 'task', ...summary }), values })

const ROWS: Row[] = [
  R(1, { status: ['Todo'], size: ['S'], points: 3, due: day('2026-01-05'), done: true }),
  R(2, { status: ['Todo'], size: ['L'], points: 5, due: day('2026-01-20') }),
  R(3, { status: ['Done'], size: ['S'], points: 2, due: day('2026-03-02'), done: true }),
  R(4, { status: ['Done'], size: ['L'], points: 8 }),
  R(5, { status: [], points: 1, due: day('2026-03-31') }),
]

const cfg = (patch: Partial<ChartViewConfig> = {}): ChartViewConfig => ({ ...DEFAULT_CHART_CONFIG, ...patch })
const build = (patch: Partial<ChartViewConfig> = {}, rows = ROWS, c = ctx()) => buildChartData(rows, cfg(patch), [task], c)
const labels = (d: ReturnType<typeof build>) => d.categories.map((c) => c.label)
const vals = (d: ReturnType<typeof build>) => d.categories.map((c) => c.values)
const paths = (rs: Row[]) => rs.map((r) => r.summary.path)

const state = (patch: Partial<ChartViewConfig> = {}): ViewState => ({
  viewDefinition: { dataViewLayout: 'chart', chartConfig: cfg(patch) },
  filterGroup: emptyFilterGroup(),
  sorts: [],
  groupBy: null,
})

describe('settings', () => {
  test('defaults fill a missing config, and a patch keeps the rest', () => {
    expect(chartConfigOf({ dataViewLayout: 'chart' })).toEqual(DEFAULT_CHART_CONFIG)
    const s = withChartConfig({ ...state(), viewDefinition: { dataViewLayout: 'chart' } }, { kind: 'line' })
    expect(s.viewDefinition.chartConfig).toEqual({ ...DEFAULT_CHART_CONFIG, kind: 'line' })
  })

  test('X defaults to the first label property, else Type', () => {
    expect(resolveX(cfg(), [task]).key).toBe('status')
    expect(resolveX(cfg(), [plain]).key).toBe('type')
    expect(resolveX(cfg({ xProperty: 'done' }), [task]).key).toBe('done')
    // A property the view no longer has falls back.
    expect(resolveX(cfg({ xProperty: 'gone' }), [task]).key).toBe('status')
    expect(axisChoices([plain]).map((c) => c.key)).toContain('type')
  })
})

describe('aggregation', () => {
  test('bar: count per label, every option kept, Other last, label colours', () => {
    const d = build({ hideEmptyGroups: false })
    expect(labels(d)).toEqual(['Todo', 'Doing', 'Done', 'Other'])
    expect(vals(d)).toEqual([[2], [0], [2], [1]])
    expect(d.colorByCategory).toBe(true)
    expect(d.categories[0].color).toBe('var(--line-red)')
    expect(d.categories[3].color).toBe('var(--line-gray)')
    expect(d.yLabel).toBe('Count')
  })

  test('hide empty groups drops groups without rows', () => {
    expect(labels(build())).toEqual(['Todo', 'Done', 'Other'])
  })

  test('a number calculation per group, formatted', () => {
    const d = build({ yCalc: 'sum', yProperty: 'points' })
    expect(vals(d)).toEqual([[8], [10], [1]])
    expect(d.yLabel).toBe('Sum (Points)')
    const avg = build({ yCalc: 'average', yProperty: 'points' })
    expect(vals(avg)).toEqual([[4], [5], [1]])
    const pct = build({ yCalc: 'percentChecked', yProperty: 'done' })
    expect(pct.percent).toBe(true)
    expect(pct.format(50)).toBe('50%')
  })

  test('a Y calculation the property does not offer falls back to the count', () => {
    expect(vals(build({ yCalc: 'sum', yProperty: 'done' }))).toEqual([[2], [2], [1]])
  })

  test('date X: month buckets, chronological, no date in Other', () => {
    const d = build({ xProperty: 'due' })
    expect(labels(d)).toEqual(['January 2026', 'March 2026', 'Other'])
    expect(vals(d)).toEqual([[2], [2], [1]])
    expect(labels(build({ xProperty: 'due', xDateBucket: 'year' }))).toEqual(['2026', 'Other'])
    expect(labels(build({ xProperty: 'due', xDateBucket: 'week' }))[0]).toBe('Jan 5 – Jan 11, 2026')
    expect(labels(build({ xProperty: 'due', xDateBucket: 'day' }))[0]).toBe('Jan 5, 2026')
  })

  test('date X without hiding empty groups fills the buckets in between', () => {
    const d = build({ xProperty: 'due', hideEmptyGroups: false })
    expect(labels(d)).toEqual(['January 2026', 'February 2026', 'March 2026', 'Other'])
    expect(vals(d)).toEqual([[2], [0], [2], [1]])
    const weeks = fillDateGaps(
      [
        { id: '2026-01-05', label: 'a', rows: [] },
        { id: '2026-01-19', label: 'b', rows: [] },
      ],
      'week',
    )
    expect(weeks.map((g) => g.id)).toEqual(['2026-01-05', '2026-01-12', '2026-01-19'])
    expect(weeks[1].label).toBe('Jan 12 – Jan 18, 2026')
  })

  test('split: one series per value, a stack per X group, the rows of each part', () => {
    const d = build({ splitBy: 'size' })
    expect(d.split).toBe(true)
    expect(d.series.map((s) => s.label)).toEqual(['S', 'L', 'Other'])
    expect(vals(d)).toEqual([
      [1, 1, 0],
      [1, 1, 0],
      [0, 0, 1],
    ])
    expect(paths(d.categories[1].seriesRows[1])).toEqual(['Tasks/T4.md'])
    expect(d.categories[0].total).toBe(2)
    // Non-label split: the palette.
    expect(build({ splitBy: 'done' }).series[0].color).toMatch(/^var\(--line-/)
  })

  test('donut and number ignore the split', () => {
    expect(build({ kind: 'donut', splitBy: 'size' }).split).toBe(false)
    expect(build({ kind: 'number', splitBy: 'size' }).split).toBe(false)
  })

  test('sort: by X either way or by Y, Other stays last', () => {
    expect(labels(build({ sort: 'xDescending' }))).toEqual(['Done', 'Todo', 'Other'])
    const byY = build({ sort: 'yDescending', yCalc: 'sum', yProperty: 'points' })
    expect(labels(byY)).toEqual(['Done', 'Todo', 'Other'])
    expect(labels(build({ sort: 'yAscending', yCalc: 'sum', yProperty: 'points' }))).toEqual(['Todo', 'Done', 'Other'])
  })

  test('cumulative line adds each point to the ones before it, per series', () => {
    const d = build({ kind: 'line', cumulative: true, xProperty: 'due', yCalc: 'sum', yProperty: 'points', hideEmptyGroups: false })
    expect(vals(d)).toEqual([[8], [8], [11], [19]])
    // Only lines accumulate.
    expect(vals(build({ kind: 'bar', cumulative: true }))).toEqual([[2], [2], [1]])
    const split = build({ kind: 'line', cumulative: true, splitBy: 'size' })
    expect(vals(split)).toEqual([
      [1, 1, 0],
      [2, 2, 0],
      [2, 2, 1],
    ])
  })

  test('number kind: one calculation over every row', () => {
    expect(numberValue(ROWS, cfg({ kind: 'number' }), [task], ctx())).toEqual({ value: 5, display: '5', label: 'Count' })
    expect(numberValue(ROWS, cfg({ kind: 'number', yCalc: 'sum', yProperty: 'points' }), [task], ctx()).display).toBe('19')
  })

  test('a split over many values calculates only the cells with rows, each row placed once', () => {
    // 2,000 rows, 40 X groups by 200 split values: 8,000 cells, at most 2,000 with rows.
    const many = Array.from({ length: 2000 }, (_, i) => R(i, { status: [['Todo', 'Doing', 'Done'][i % 3]], note: `n${i % 200}`, points: i % 7, due: day(`20${String(10 + (i % 40)).padStart(2, '0')}-01-10`) }))
    vi.mocked(calculate).mockClear()
    const d = build({ xProperty: 'due', xDateBucket: 'year', splitBy: 'note', yCalc: 'sum', yProperty: 'points' }, many)
    expect(d.categories).toHaveLength(40)
    expect(d.series).toHaveLength(200)
    expect(vi.mocked(calculate).mock.calls.length).toBeLessThanOrEqual(2000)
    // Every row sits in exactly one cell, and the empty cells are 0.
    expect(d.categories.reduce((n, c) => n + c.seriesRows.reduce((m, rs) => m + rs.length, 0), 0)).toBe(2000)
    const sum = (rs: Row[]) => rs.reduce((n, r) => n + (r.values.points as number), 0)
    for (const c of d.categories) c.seriesRows.forEach((rs, si) => expect(c.values[si]).toBe(sum(rs)))
  })

  test('2,000 rows aggregate quickly', () => {
    const many = Array.from({ length: 2000 }, (_, i) =>
      R(i, { status: [['Todo', 'Doing', 'Done'][i % 3]], size: [i % 2 ? 'S' : 'L'], points: i % 7, due: day(`2026-${String((i % 12) + 1).padStart(2, '0')}-10`) }),
    )
    const t0 = performance.now()
    const d = build({ xProperty: 'due', splitBy: 'status', yCalc: 'sum', yProperty: 'points' }, many)
    expect(d.categories).toHaveLength(12)
    expect(performance.now() - t0).toBeLessThan(1500)
  })
})

describe('Show as table: a group as a filter', () => {
  const c = ctx()
  const byId = typeMap(types)
  /** The filters keep exactly the group's rows. */
  const exact = (rows: Row[], patch: Partial<ChartViewConfig>) => {
    const d = build(patch, rows)
    for (const cat of d.categories) {
      const fs = filtersForGroup(d.x, cat.group, cfg(patch).xDateBucket, c)
      expect(fs, cat.label).not.toBeNull()
      for (const f of fs!) expect(filterIsValid(f, byId, c.viewTypeIds)).toBe(true)
      const kept = applyFilters(rows, addFilters(emptyFilterGroup(), fs!), c)
      expect(paths(kept), cat.label).toEqual(paths(cat.group.rows))
    }
  }

  test('labels (and Other), booleans, numbers, dates, texts', () => {
    exact(ROWS, {})
    exact(ROWS, { xProperty: 'done' })
    exact(ROWS, { xProperty: 'points' })
    exact(ROWS, { xProperty: 'due' })
    exact(ROWS, { xProperty: 'due', xDateBucket: 'week' })
    exact([R(1, { note: 'x' }), R(2, { note: 'y' }), R(3)], { xProperty: 'note' })
  })

  test('relations and tags resolve to object ids; unresolved ones are not filters', () => {
    const rows = [
      R(1, { owner: [{ target: 'Ann', path: 'People/Ann.md' }] }, { tags: ['alpha'] }),
      R(2, { owner: [{ target: 'Nobody', path: null }] }, { tags: ['beta'] }),
      R(3),
    ]
    const owner = build({ xProperty: 'owner' }, rows)
    const ann = owner.categories.find((x) => x.label === 'Ann')!
    expect(filtersForGroup(owner.x, ann.group, 'month', c)).toEqual([{ type: 'filter', propertyId: 'owner', option: 'contains', referenceValue: ['idAnn'] }])
    const nobody = owner.categories.find((x) => x.label === 'Nobody')!
    expect(filtersForGroup(owner.x, nobody.group, 'month', c)).toBeNull()
    const tags = build({ xProperty: 'tags' }, rows)
    expect(filtersForGroup(tags.x, tags.categories.find((x) => x.label === 'alpha')!.group, 'month', c)?.[0].referenceValue).toEqual(['tagA'])
    expect(filtersForGroup(tags.x, tags.categories.find((x) => x.label === 'beta')!.group, 'month', c)).toBeNull()
  })

  test('the table state: layout table, the filters joined by AND, in one state', () => {
    const s = state({ splitBy: 'size' })
    const d = build({ splitBy: 'size' })
    const next = tableStateFor(s, d, d.categories[0], 0, ctx())!
    expect(next.viewDefinition.dataViewLayout).toBe('table')
    expect(next.viewDefinition.chartConfig).toEqual(s.viewDefinition.chartConfig)
    expect(next.filterGroup.elements).toEqual([
      { type: 'filter', propertyId: 'status', option: 'contains', referenceValue: ['o1'] },
      { type: 'filter', propertyId: 'size', option: 'contains', referenceValue: ['o1'] },
    ])
    expect(paths(applyFilters(ROWS, next.filterGroup, ctx()))).toEqual(paths(d.categories[0].seriesRows[0]))
  })

  test('checked against the rows: a group the filter would not keep exactly is not a filter', () => {
    // Texts group trimmed and case-sensitive, but "is" matches any case: "Alpha" would keep "alpha" too.
    const texts = [R(1, { note: 'Alpha' }), R(2, { note: 'alpha' }), R(3, { note: 'Beta' })]
    const s = state({ xProperty: 'note' })
    const dt = build({ xProperty: 'note' }, texts)
    const alpha = dt.categories.find((x) => x.label === 'Alpha')!
    expect(tableStateFor(s, dt, alpha, null, ctx())).not.toBeNull()
    expect(tableStateFor(s, dt, alpha, null, ctx(), texts)).toBeNull()
    const beta = dt.categories.find((x) => x.label === 'Beta')!
    expect(tableStateFor(s, dt, beta, null, ctx(), texts)).not.toBeNull()
    // A label outside the option set falls in "Other", which "is empty" doesn't keep.
    const ghosts = [R(1, { status: ['Ghost'] }), R(2, { status: [] }), R(3, { status: ['Todo'] })]
    const dl = build({}, ghosts)
    const other = dl.categories.find((x) => x.group.isOther)!
    expect(paths(other.group.rows)).toEqual(['Tasks/T1.md', 'Tasks/T2.md'])
    expect(tableStateFor(state({}), dl, other, null, ctx(), ghosts)).toBeNull()
    const todo = dl.categories.find((x) => x.label === 'Todo')!
    expect(tableStateFor(state({}), dl, todo, null, ctx(), ghosts)).not.toBeNull()
  })

  test('an OR filter group is wrapped, an empty one replaced', () => {
    const f = { type: 'filter' as const, propertyId: 'done', option: 'isChecked' }
    const or = { type: 'filterGroup' as const, operator: 'or' as const, elements: [f] }
    expect(addFilters(or, [f])).toEqual({ type: 'filterGroup', operator: 'and', elements: [or, f] })
    expect(addFilters({ ...or, elements: [] }, [f])).toEqual({ type: 'filterGroup', operator: 'and', elements: [f] })
  })

  test('a property only one of the view types has adds a type filter', () => {
    const x = { ...resolveX(cfg(), [task, plain]) }
    expect(x.typeId).toBe('task')
    const d = buildChartData(ROWS, cfg(), [task, plain], ctx({ viewTypeIds: ['task', 'plain'] }))
    const fs = filtersForGroup(d.x, d.categories[0].group, 'month', ctx({ viewTypeIds: ['task', 'plain'] }))!
    expect(fs[0]).toEqual({ type: 'filter', propertyId: 'type', option: 'contains', referenceValue: ['task'] })
  })
})

describe('scale', () => {
  test('round ticks from zero, whole numbers for counts', () => {
    expect(niceScale([7]).ticks).toEqual([0, 2, 4, 6, 8])
    expect(niceScale([0, 0]).ticks.at(-1)).toBe(1)
    expect(niceScale([3], 5, true).ticks).toEqual([0, 1, 2, 3])
    expect(niceScale([-4, 9]).min).toBeLessThan(0)
    expect(shortNumber(12500)).toBe('12.5K')
    expect(shortNumber(2_000_000)).toBe('2M')
    expect(truncate('September 2026', 6)).toBe('Septe…')
  })
})
