import { describe, expect, test } from 'vitest'
import type { Row, TypeDef } from '@/api/types'
import { settingsDefaults, useSettings } from '@/settings/useSettings'
import { collection, objectSummary, propertyDef, row, typeDef } from '@/test/mockApi'
import { GROUP_OPTIONS, GROUP_SORT_OPTIONS, canDropRow, groupRows, isGroupable, valueForGroup, type GroupCtx } from './group'

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
    expect(GROUP_OPTIONS('datetime').map((o) => o.label)).toEqual(['By Hour', 'By Day', 'By Week', 'By Month', 'By Year', 'Relative', 'Scheduled'])
    expect(GROUP_OPTIONS('label').map((o) => o.key)).toEqual(['default'])
    // "Created at" groups like "Last updated" (All notes itself groups by it, Relative).
    expect(isGroupable('entity_createdAt')).toBe(true)
    expect(GROUP_OPTIONS('entity_createdAt')).toEqual(GROUP_OPTIONS('entity_lastUpdated'))
    expect(GROUP_OPTIONS('entity_createdAt').map((o) => o.label)).toContain('Relative')
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

  test('number ranges with a fractional step place values and label cleanly', () => {
    const rows = [R('a', { qty: 0.3 }), R('b', { qty: 0.7 }), R('c', { qty: 1 })]
    const { groups } = groupRows(rows, by('qty', 'range', { numberRangeConfig: { min: 0, max: 1, step: 0.1 } }), undefined, ctx())
    expect(groups.map((g) => [g.label, paths(g.rows)])).toEqual([
      ['0.3–0.4', ['a']],
      ['0.7–0.8', ['b']],
      ['0.9–1', ['c']],
    ])
  })

  test('date Relative buckets against fixed now', () => {
    const d = (day: number) => ({ start: `2026-10-${String(day).padStart(2, '0')}`, resolution: 'day' })
    const rows = [R('today', { due: d(23) }), R('yest', { due: d(22) }), R('tom', { due: d(24) }), R('lastw', { due: d(15) }), R('nextw', { due: d(28) }), R('old', { due: d(1) }), R('none', {})]
    const { groups } = groupRows(rows, by('due', 'relative'), undefined, ctx())
    expect(labels(groups)).toEqual(['Earlier', 'Last week', 'Yesterday', 'Today', 'Tomorrow', 'Next week', 'Other'])
  })

  test('By Hour labels follow the Time format setting', () => {
    const rows = [R('a', { due: { start: '2026-11-08T14:05:00.000Z', resolution: 'time' } })]
    try {
      useSettings.setState({ settings: { ...settingsDefaults, timeZone: 'UTC' } })
      expect(labels(groupRows(rows, by('due', 'hour'), undefined, ctx()).groups)).toEqual(['Nov 8, 2026, 2 PM'])
      useSettings.setState({ settings: { ...settingsDefaults, timeZone: 'UTC', twentyFourHourTime: true } })
      expect(labels(groupRows(rows, by('due', 'hour'), undefined, ctx()).groups)).toEqual(['Nov 8, 2026, 14:00'])
    } finally {
      useSettings.setState({ settings: settingsDefaults })
    }
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

  test('a text value "other" is not the Other group (audit 2026-11-01)', () => {
    const { groups } = groupRows([R('a', { note: 'other' }), R('b', {})], by('note'), undefined, ctx())
    expect(groups.map((g) => paths(g.rows))).toEqual([['a'], ['b']])
    expect(new Set(ids(groups)).size).toBe(2)
    expect(groups[0].isOther).toBeUndefined()
    expect(groups[1].isOther).toBe(true)
    const note = page.propertyDefinitions.find((d) => d.id === 'note')!
    expect(valueForGroup(by('note'), groups[0], note)).toEqual({ key: 'note', value: 'other' })
    expect(valueForGroup(by('note'), groups[1], note)).toEqual({ key: 'note', value: '' })
  })

  test('a config saved with bare ids (before text groups got the "text:" prefix) still hides and orders them (review fix 2026-11-01 #2)', () => {
    const rows = [R('a', { note: 'Work' }), R('b', { note: 'Home' }), R('c', { note: 'Play' })]
    const config = {
      groups: [
        { id: 'Play', isHidden: false, isClosed: false },
        { id: 'Work', isHidden: false, isClosed: false },
        { id: 'Home', isHidden: true, isClosed: false },
      ],
    }
    const { groups, hidden } = groupRows(rows, { ...by('note'), sortOption: 'manual' }, config, ctx())
    expect(labels(groups)).toEqual(['Play', 'Work'])
    expect(labels(hidden)).toEqual(['Home'])
    // The current, prefixed ids keep working too.
    const prefixed = { groups: config.groups.map((g) => ({ ...g, id: 'text:' + g.id })) }
    expect(labels(groupRows(rows, { ...by('note'), sortOption: 'manual' }, prefixed, ctx()).groups)).toEqual(['Play', 'Work'])
  })

  test('only the label of a long text group is cut: the id and the written value keep the whole text (audit 2026-11-01 #13)', () => {
    const long = 'x'.repeat(500)
    const { groups } = groupRows([R('a', { note: `${long}A` }), R('b', { note: `${long}B` }), R('c', { note: 'short' })], by('note'), undefined, ctx())
    // Two texts sharing a 500-character prefix are two groups.
    expect(groups.map((g) => paths(g.rows)).sort()).toEqual([['a'], ['b'], ['c']])
    const [ga, gb, gc] = ['a', 'b', 'c'].map((p) => groups.find((g) => g.rows[0].summary.path === p)!)
    expect(ga.label).toHaveLength(500)
    expect(ga.id).not.toBe(gb.id)
    const note = page.propertyDefinitions.find((d) => d.id === 'note')!
    expect(valueForGroup(by('note'), ga, note, { row: gc.rows[0], from: gc })).toEqual({ key: 'note', value: `${long}A` })
    expect(valueForGroup(by('note'), gc, note)).toEqual({ key: 'note', value: 'short' })
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

  // Audit 2026-11-07 #41: a textBlock column is its value's first paragraph, so a drop would write
  // only that and lose the rest: such a card isn't dropped into another column (as dates and
  // formulas). Fix-pass L3: a card whose value is one paragraph loses nothing, so it still moves.
  test('a drop that would lose text from a textBlock value is refused; one paragraph still moves', () => {
    const body = propertyDef({ id: 'body', type: 'textBlock' })
    const withBody = typeDef({ id: 'page', propertyDefinitions: [propertyDef({ id: 'title', type: 'entity_title' }), body] })
    const rows = [R('a', { body: 'First\n\nSecond paragraph' }), R('b', { body: 'Other' }), R('c', { body: 'Third\n\n' })]
    const { groups } = groupRows(rows, by('body'), undefined, ctx({ types: [withBody] }))
    const [ga, gb, gc] = ['a', 'b', 'c'].map((p) => groups.find((g) => g.rows[0].summary.path === p)!)
    expect(ga.label).toBe('First')
    expect(valueForGroup(by('body'), gb, body, { row: ga.rows[0], from: ga })).toBeNull()
    expect(valueForGroup(by('body'), ga, body, { row: gb.rows[0], from: gb })).toEqual({ key: 'body', value: 'First' })
    expect(valueForGroup(by('body'), gb, body, { row: gc.rows[0], from: gc })).toEqual({ key: 'body', value: 'Other' })
    expect(valueForGroup(by('body'), gb, body)).toEqual({ key: 'body', value: 'Other' })
  })

  test('collection ids resolve in groups', () => {
    const c = collection({ id: 'tools', name: 'Tooling' })
    const { groups } = groupRows([R('a', {}, { collections: ['tooling'] })], by('collections'), undefined, ctx({ collections: [c] }))
    expect(ids(groups)).toEqual(['tools'])
  })

  test("a key shared by two types groups by the view's type's definition (audit #15)", () => {
    const other = typeDef({ id: 'other', propertyDefinitions: [propertyDef({ id: 'stage', type: 'label', options: { set: opts('X', 'Y') } })] })
    const mine = typeDef({ id: 'mine', propertyDefinitions: [propertyDef({ id: 'stage', type: 'label', options: { set: opts('Draft', 'Live') } })] })
    const c: GroupCtx = { types: [other, mine], viewTypeIds: ['mine'], collections: [], tagIdsToTitles: {}, now }
    const r = R('a', { stage: ['Live'] }, { type: 'mine' })
    expect(labels(groupRows([r], by('stage'), undefined, c).groups)).toEqual(['Draft', 'Live'])
  })

  test('a row whose type defines the key as another kind sits in Other and cannot be dropped (audit 2026-11-01 #12)', () => {
    const a = typeDef({ id: 'a', propertyDefinitions: [propertyDef({ id: 'status', type: 'label', options: { isArray: false, set: opts('Done') } })] })
    const b = typeDef({ id: 'b', propertyDefinitions: [propertyDef({ id: 'status', type: 'text' })] })
    const c: GroupCtx = { types: [a, b], viewTypeIds: ['a', 'b'], collections: [], tagIdsToTitles: {}, now }
    const rows = [R('A/x.md', { status: ['Done'] }, { type: 'a' }), R('B/y.md', { status: 'Done' }, { type: 'b' })]
    const { groups } = groupRows(rows, by('status'), undefined, c)
    expect(ids(groups)).toEqual(['o1', 'other'])
    expect(paths(groups[0].rows)).toEqual(['A/x.md'])
    expect(paths(groups[1].rows)).toEqual(['B/y.md'])
    const def = a.propertyDefinitions[0]
    expect(canDropRow(rows[0], by('status').groups[0], def, c.types)).toBe(true)
    expect(canDropRow(rows[1], by('status').groups[0], def, c.types)).toBe(false)
  })

  test('a drag of a multi-value card swaps only the source column value (audit #13)', () => {
    const labels = propertyDef({ id: 'labels', type: 'label', options: { isArray: true, set: opts('A', 'B', 'C') } })
    const owners = propertyDef({ id: 'owner', type: 'entity', options: { isArray: true } })
    const t = typeDef({ id: 'page', propertyDefinitions: [labels, owners] })
    const c = (extra: Partial<GroupCtx> = {}): GroupCtx => ({ types: [t], collections: [], tagIdsToTitles: {}, now, ...extra })
    const r = R('a', {
      labels: ['A', 'C'],
      owner: [
        { target: 'Ann', path: 'People/Ann.md' },
        { target: 'Cy', path: 'People/Cy.md' },
      ],
    }, { tags: ['x', 'z'] })
    const lg = groupRows([r], by('labels'), undefined, c()).groups
    const byLabel = (gs: { label: string }[], l: string) => gs.find((g) => g.label === l)! as (typeof lg)[number]
    expect(valueForGroup(by('labels'), byLabel(lg, 'B'), labels, { row: r, from: byLabel(lg, 'A') })).toEqual({ key: 'labels', value: ['C', 'B'] })

    const tg = groupRows([r, R('b', {}, { tags: ['y'] })], by('tags'), undefined, c()).groups
    expect(valueForGroup(by('tags'), byLabel(tg, 'y'), { type: 'entity_tags', options: {} }, { row: r, from: byLabel(tg, 'x') })).toEqual({
      key: 'tags',
      value: ['z', 'y'],
    })

    const people = R('b', { owner: [{ target: 'Bo', path: 'People/Bo.md' }] })
    const eg = groupRows([r, people], by('owner'), undefined, c()).groups
    const bo = eg.find((g) => g.id === 'People/Bo.md')!
    const ann = eg.find((g) => g.id === 'People/Ann.md')!
    expect(valueForGroup(by('owner'), bo, owners, { row: r, from: ann })).toEqual({
      key: 'owner',
      value: [
        { target: 'Cy', path: 'People/Cy.md' },
        { target: 'Bo', path: 'People/Bo.md' },
      ],
    })
  })
})

describe('task groupings (M4)', () => {
  // A task status set with an option that has no category ("Someday").
  const taskStatus = propertyDef({
    id: 'status',
    type: 'label',
    options: {
      isStatus: true,
      set: [
        { id: 's1', text: 'Not Started', color: 'red', icon: null, statusCategory: 'not-started' },
        { id: 's2', text: 'In Progress', color: 'blue', icon: null, statusCategory: 'in-progress' },
        { id: 's3', text: 'On Hold', color: 'pink', icon: null, statusCategory: 'blocked' },
        { id: 's4', text: 'Done', color: 'green', icon: null, statusCategory: 'done' },
        { id: 's5', text: 'Someday', color: 'gray', icon: null },
        { id: 's6', text: 'Shipped', color: 'green', icon: null, statusCategory: 'done' },
      ],
    },
  })
  const taskType = typeDef({ id: 'task', propertyDefinitions: [taskStatus, propertyDef({ id: 'date', type: 'datetimeSimple' })] })
  const tctx = (): GroupCtx => ({ types: [taskType], collections: [], tagIdsToTitles: {}, now })
  const T = (path: string, values: Row['values'] = {}): Row => row({ summary: objectSummary({ path, type: 'task' }), values })
  const cat = { groups: [{ propertyId: 'status', option: 'statusCategory' }] }

  test('status category option offered only for a status label; scheduled for dates', () => {
    expect(GROUP_OPTIONS('label', taskStatus).map((o) => `${o.key}:${o.label}`)).toEqual(['default:default', 'statusCategory:By category'])
    expect(GROUP_OPTIONS('label', flavor).map((o) => o.key)).toEqual(['default'])
    expect(GROUP_OPTIONS('label').map((o) => o.key)).toEqual(['default'])
    expect(GROUP_OPTIONS('datetime').map((o) => o.label)).toEqual(['By Hour', 'By Day', 'By Week', 'By Month', 'By Year', 'Relative', 'Scheduled'])
    expect(GROUP_OPTIONS('datetimeSimple').at(-1)).toEqual({ key: 'scheduled', label: 'Scheduled' })
  })

  test('status category groups in order with no-category and Other in Not started', () => {
    const rows = [
      T('done', { status: ['Done'] }),
      T('shipped', { status: ['Shipped'] }),
      T('doing', { status: ['In Progress'] }),
      T('someday', { status: ['Someday'] }),
      T('none', { status: [] }),
      T('unknown', { status: ['Gone'] }),
      T('ns', { status: ['Not Started'] }),
    ]
    const { groups, hidden } = groupRows(rows, cat, undefined, tctx())
    expect(ids(groups)).toEqual(['not-started', 'in-progress', 'blocked', 'done'])
    expect(hidden).toEqual([])
    expect(paths(groups[0].rows)).toEqual(['someday', 'none', 'unknown', 'ns'])
    expect(paths(groups[1].rows)).toEqual(['doing'])
    expect(groups[2].rows).toEqual([])
    expect(paths(groups[3].rows)).toEqual(['done', 'shipped'])
    expect(groups.some((g) => g.isOther)).toBe(false)
  })

  test('category group labels', () => {
    const { groups } = groupRows([], cat, undefined, tctx())
    expect(labels(groups)).toEqual(['Not started', 'In progress', 'Blocked', 'Done'])
  })

  test('category groups honour hideEmptyGroups and hideByDefault', () => {
    const rows = [T('a', { status: ['Done'] })]
    expect(ids(groupRows(rows, cat, { groups: [], hideEmptyGroups: true }, tctx()).groups)).toEqual(['done'])
    const cfg = { groups: [{ id: 'done', isHidden: false, isClosed: false }], hideByDefault: true }
    const r = groupRows(rows, cat, cfg, tctx())
    expect(ids(r.groups)).toEqual(['done'])
    expect(ids(r.hidden)).toEqual(['not-started', 'in-progress', 'blocked'])
  })

  test('valueForGroup category writes first option of the category', () => {
    const { groups } = groupRows([], cat, undefined, tctx())
    const byId = Object.fromEntries(groups.map((g) => [g.id, g]))
    expect(valueForGroup(cat, byId['done'], taskStatus)).toEqual({ key: 'status', value: ['Done'] })
    expect(valueForGroup(cat, byId['not-started'], taskStatus)).toEqual({ key: 'status', value: ['Not Started'] })
    expect(valueForGroup(cat, byId['blocked'], taskStatus)).toEqual({ key: 'status', value: ['On Hold'] })
    // A category the set has no option for can't be dropped into.
    const bare = propertyDef({ id: 'status', type: 'label', options: { isStatus: true, set: [{ id: 'x', text: 'Done', color: null, icon: null, statusCategory: 'done' }] } })
    expect(valueForGroup(cat, byId['blocked'], bare)).toBeNull()
    // "Someday" has no category, so it is the first not-started option of the bare-ish set.
    const nocat = propertyDef({ id: 'status', type: 'label', options: { isStatus: true, set: [{ id: 'y', text: 'Someday', color: null, icon: null }] } })
    expect(valueForGroup(cat, byId['not-started'], nocat)).toEqual({ key: 'status', value: ['Someday'] })
  })

  test('scheduled buckets against fixed now', () => {
    // now: Friday 2026-10-23. This week runs Mon 19 – Sun 25; next week Mon 26 – Sun Nov 1.
    const d = (s: string) => ({ start: s, resolution: 'day' })
    const rows = [
      T('none', {}),
      T('later', { date: d('2026-11-02') }),
      T('nextw', { date: d('2026-10-28') }),
      T('sun', { date: d('2026-10-25') }),
      T('tom', { date: d('2026-10-24') }),
      T('today', { date: d('2026-10-23') }),
      T('todayTime', { date: { start: '2026-10-23T15:00:00', resolution: 'time' } }),
      T('yest', { date: d('2026-10-22') }),
      T('old', { date: d('2026-01-01') }),
    ]
    const by2 = { groups: [{ propertyId: 'date', option: 'scheduled' }] }
    const { groups } = groupRows(rows, by2, undefined, tctx())
    expect(labels(groups)).toEqual(['Overdue', 'Today', 'Tomorrow', 'This week', 'Next week', 'Later', 'No date'])
    expect(ids(groups)).toEqual(['overdue', 'today', 'tomorrow', 'thisWeek', 'nextWeek', 'later', 'other'])
    expect(paths(groups[0].rows)).toEqual(['yest', 'old'])
    expect(paths(groups[1].rows)).toEqual(['today', 'todayTime'])
    expect(paths(groups[3].rows)).toEqual(['sun'])
    expect(groups.at(-1)!.isOther).toBe(true)
    expect(valueForGroup(by2, groups[1], { type: 'datetimeSimple', options: {} })).toBeNull()
  })

  test('scheduled on a Sunday: tomorrow is next week, but Tomorrow wins', () => {
    const sunday = new Date(2026, 9, 25, 9, 0)
    const d = (s: string) => ({ start: s, resolution: 'day' })
    const rows = [T('mon', { date: d('2026-10-26') }), T('tue', { date: d('2026-10-27') })]
    const { groups } = groupRows(rows, { groups: [{ propertyId: 'date', option: 'scheduled' }] }, undefined, { ...tctx(), now: sunday })
    expect(labels(groups)).toEqual(['Tomorrow', 'Next week'])
  })

  test('scheduled on a Sunday with the week starting on Sunday: the Saturday after is this week', () => {
    const sunday = new Date(2026, 9, 25, 9, 0)
    const d = (s: string) => ({ start: s, resolution: 'day' })
    const by2 = { groups: [{ propertyId: 'date', option: 'scheduled' }] }
    const rows = [T('tue', { date: d('2026-10-27') }), T('sat', { date: d('2026-10-31') }), T('nextSun', { date: d('2026-11-01') })]
    const sun = groupRows(rows, by2, undefined, { ...tctx(), now: sunday, weekStart: 'sunday' }).groups
    expect(labels(sun)).toEqual(['This week', 'Next week'])
    expect(paths(sun[0].rows)).toEqual(['tue', 'sat'])
    expect(paths(sun[1].rows)).toEqual(['nextSun'])
    // Monday weeks (the default) put every one of them in next week.
    const mon = groupRows(rows, by2, undefined, { ...tctx(), now: sunday, weekStart: 'monday' }).groups
    expect(labels(mon)).toEqual(['Next week'])
    expect(labels(groupRows(rows, by2, undefined, { ...tctx(), now: sunday }).groups)).toEqual(['Next week'])
  })

  test('By Week and Relative buckets follow the week start', () => {
    const d = (s: string) => ({ start: s, resolution: 'day' })
    const rows = [T('sun', { date: d('2026-10-25') }), T('sat', { date: d('2026-10-31') })]
    const week = { groups: [{ propertyId: 'date', option: 'week' }] }
    const sun = groupRows(rows, week, undefined, { ...tctx(), weekStart: 'sunday' }).groups
    expect(ids(sun)).toEqual(['2026-10-25'])
    expect(labels(sun)).toEqual(['Oct 25 – Oct 31, 2026'])
    const mon = groupRows(rows, week, undefined, tctx()).groups
    expect(ids(mon)).toEqual(['2026-10-19', '2026-10-26'])
    // Relative, seen from Thursday 22 Oct: Sunday 25 Oct is this week on Monday weeks, next week on Sunday weeks.
    const thursday = new Date(2026, 9, 22, 12, 0)
    const rel = { groups: [{ propertyId: 'date', option: 'relative' }] }
    const sunRow = [T('sun', { date: d('2026-10-25') })]
    expect(ids(groupRows(sunRow, rel, undefined, { ...tctx(), now: thursday }).groups)).toEqual(['thisWeek'])
    expect(ids(groupRows(sunRow, rel, undefined, { ...tctx(), now: thursday, weekStart: 'sunday' }).groups)).toEqual(['nextWeek'])
  })
})

describe('group by backlinks (M5)', () => {
  test('test group by backlinks gives one group per linking object and Other', () => {
    const bl = propertyDef({ id: 'backlinks', name: 'Backlinks', type: 'entity_backlinks' })
    const person = typeDef({ id: 'person', propertyDefinitions: [propertyDef({ id: 'title', type: 'entity_title' }), bl] })
    const P = (path: string, backlinks: { target: string; path: string | null }[]) =>
      row({ summary: objectSummary({ path, type: 'person' }), values: { backlinks } })
    const rows = [
      P('a', [{ target: 'Ada', path: 'People/Ada.md' }]),
      P('b', [
        { target: 'Bob', path: 'People/Bob.md' },
        { target: 'Ada', path: 'People/Ada.md' },
      ]),
      P('c', []),
    ]
    const c: GroupCtx = { types: [person], collections: [], tagIdsToTitles: {}, now, entityTitles: { 'People/Ada.md': 'Ada Lovelace' } }
    const { groups } = groupRows(rows, by('backlinks'), undefined, c)
    expect(ids(groups)).toEqual(['People/Ada.md', 'People/Bob.md', 'other'])
    expect(labels(groups)).toEqual(['Ada Lovelace', 'Bob', 'Other'])
    expect(groups.map((g) => paths(g.rows))).toEqual([['a', 'b'], ['b'], ['c']])
    // Read-only: a drag into a backlinks group writes nothing.
    expect(valueForGroup(by('backlinks'), groups[0], bl)).toBeNull()
    expect(GROUP_SORT_OPTIONS('entity_backlinks').map((o) => o.label)).toContain('Created oldest first')
  })
})
