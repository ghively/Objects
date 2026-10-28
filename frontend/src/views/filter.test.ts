import { describe, expect, test } from 'vitest'
import type { Collection, Filter, FilterGroup, PropertyDef, Row, TypeDef } from '@/api/types'
import { collection, objectSummary, propertyDef, row, typeDef } from '@/test/mockApi'
import { FILTER_OPTIONS, filterIsValid, filterOptionsFor, matchFilter, matchGroup, applyFilters, rowValue, type FilterCtx } from './filter'
import { resolveRelative } from './dates'

const now = new Date(2026, 9, 23, 12, 0)

const status: PropertyDef = propertyDef({
  id: 'status',
  type: 'label',
  options: {
    set: [
      { id: 'o1', text: 'Todo', color: null, icon: null },
      { id: 'o2', text: 'Done', color: null, icon: null },
    ],
  },
})
const props: PropertyDef[] = [
  propertyDef({ id: 'title', type: 'entity_title' }),
  propertyDef({ id: 'note', type: 'text' }),
  propertyDef({ id: 'qty', type: 'number' }),
  propertyDef({ id: 'done', type: 'boolean' }),
  propertyDef({ id: 'due', type: 'datetime' }),
  status,
]
const page = typeDef({ id: 'page', propertyDefinitions: props })
const task = typeDef({ id: 'task', propertyDefinitions: [propertyDef({ id: 'title', type: 'entity_title' }), propertyDef({ id: 'prio', type: 'number' })] })
const types: TypeDef[] = [page, task]

const ctx = (extra: Partial<FilterCtx> = {}, collections: Collection[] = []): FilterCtx => ({
  types,
  collections,
  tagIdsToTitles: {},
  now,
  ...extra,
})

const R = (path: string, values: Row['values'] = {}, summary: Partial<Row['summary']> = {}, type = 'page'): Row =>
  row({ summary: objectSummary({ path, type, ...summary }), values })

const f = (propertyId: string, option: string, referenceValue?: Filter['referenceValue'], structureId?: string): Filter => ({
  type: 'filter',
  propertyId,
  option,
  ...(referenceValue !== undefined ? { referenceValue } : {}),
  ...(structureId ? { structureId } : {}),
})
const group = (operator: 'and' | 'or', ...elements: FilterGroup['elements']): FilterGroup => ({
  type: 'filterGroup',
  operator,
  elements,
})
const paths = (rows: Row[]) => rows.map((r) => r.summary.path)

describe('filter engine', () => {
  test('operator table per kind', () => {
    const table = Object.fromEntries(
      (['text', 'number', 'boolean', 'label', 'entity', 'entity_type', 'entity_aliases', 'entity_icon', 'datetime'] as const).map((k) => [
        k,
        FILTER_OPTIONS[k].map((o) => `${o.key}:${o.label}`),
      ]),
    )
    expect(table).toMatchInlineSnapshot(`
      {
        "boolean": [
          "isChecked:is selected",
          "isNotChecked:is not selected",
        ],
        "datetime": [
          "isNotEmpty:is not empty",
          "isEmpty:is empty",
          "startIsNotEmpty:start is not empty",
          "endIsEmpty:end is empty",
          "endIsNotEmpty:end is not empty",
          "is:is",
          "isBefore:is before",
          "isAfter:is after",
          "isOnOrBefore:is on or before",
          "isOnOrAfter:is on or after",
          "startIs:starts",
          "startIsBefore:starts before",
          "startIsAfter:starts after",
          "startIsOnOrBefore:starts on or before",
          "startIsOnOrAfter:starts on or after",
          "endIs:ends on",
          "endIsBefore:ends before",
          "endIsAfter:ends after",
          "endIsOnOrBefore:ends on or before",
          "endIsOnOrAfter:ends on or after",
        ],
        "entity": [
          "isEmpty:is empty",
          "isNotEmpty:is not empty",
          "contains:includes",
          "notContains:does not include",
        ],
        "entity_aliases": [
          "contains:includes",
          "notContains:does not include",
          "isEmpty:is empty",
          "isNotEmpty:is not empty",
        ],
        "entity_icon": [
          "isEmpty:is empty",
          "isNotEmpty:is not empty",
          "is:is",
          "isNot:is not",
        ],
        "entity_type": [
          "contains:is",
          "notContains:is not",
        ],
        "label": [
          "isEmpty:is empty",
          "isNotEmpty:is not empty",
          "contains:includes",
          "notContains:does not include",
        ],
        "number": [
          "equal:=",
          "notEqual:≠",
          "greaterEqual:≥",
          "greater:>",
          "smallerEqual:≤",
          "smaller:<",
        ],
        "text": [
          "isEmpty:is empty",
          "isNotEmpty:is not empty",
          "contains:includes",
          "notContains:does not include",
          "is:is",
          "isNot:is not",
          "startsWith:starts with",
          "endsWith:ends with",
        ],
      }
    `)
  })

  test('date start/end options need an end time to be allowed; blocks only get the empty options', () => {
    const keys = (d: Pick<PropertyDef, 'type' | 'options'>) => filterOptionsFor(d).map((o) => o.key)
    expect(keys({ type: 'datetime', options: { constraints: { endTimeSettings: 'notAllowed' } } })).not.toContain('startIs')
    expect(keys({ type: 'datetime', options: {} })).toContain('endIsOnOrAfter')
    expect(keys({ type: 'datetimeSimple', options: {} })).not.toContain('endIs')
    expect(keys({ type: 'blocks', options: {} }).sort()).toEqual(['isEmpty', 'isNotEmpty'])
    expect(keys({ type: 'simpleTableBlock', options: {} }).sort()).toEqual(['isEmpty', 'isNotEmpty'])
  })

  test('nested and/or groups', () => {
    const rows = [
      R('a', { note: 'x', qty: 1 }),
      R('b', { note: 'x', qty: 5 }),
      R('c', { note: 'x', qty: 9 }),
      R('d', { note: 'y', qty: 5 }),
    ]
    const g = group('and', f('note', 'is', 'x'), group('or', f('qty', 'equal', 5), f('qty', 'equal', 9)))
    expect(paths(applyFilters(rows, g, ctx()))).toEqual(['b', 'c'])
  })

  test('empty group passes', () => {
    const rows = [R('a'), R('b')]
    expect(paths(applyFilters(rows, group('and'), ctx()))).toEqual(['a', 'b'])
    expect(matchGroup(rows[0], group('or', group('and')), ctx())).toBe(true)
  })

  test('filter on deleted property is ignored', () => {
    const rows = [R('a', { note: 'x' }), R('b', { note: 'y' })]
    const gone = f('removed', 'is', 'x')
    expect(filterIsValid(gone, { page, task })).toBe(false)
    expect(paths(applyFilters(rows, group('and', gone), ctx()))).toEqual(['a', 'b'])
    // an option that no longer exists for the kind
    const badOption = f('note', 'equal', 1)
    expect(filterIsValid(badOption, { page, task })).toBe(false)
    expect(paths(applyFilters(rows, group('and', badOption), ctx()))).toEqual(['a', 'b'])
    // ignored inside an OR group too: it must not make every row pass
    expect(paths(applyFilters(rows, group('or', gone, f('note', 'is', 'x')), ctx()))).toEqual(['a'])
  })

  test("a key shared by two types is checked against the view's type's definition (audit #15)", () => {
    // `qty` is a number on page (first) and a label on `stock`, the type the view shows.
    const stock = typeDef({
      id: 'stock',
      propertyDefinitions: [propertyDef({ id: 'qty', type: 'label', options: { set: [{ id: 'q1', text: 'Low', color: null, icon: null }] } })],
    })
    const c = ctx({ types: [page, stock], viewTypeIds: ['stock'] })
    const rows = [R('a', { qty: ['Low'] }, {}, 'stock'), R('b', { qty: [] }, {}, 'stock')]
    expect(paths(applyFilters(rows, group('and', f('qty', 'contains', ['q1'])), c))).toEqual(['a'])
  })

  test('structureId scopes filter to one type', () => {
    const rows = [R('a', { qty: 1 }), R('t1', { prio: 1 }, {}, 'task'), R('t2', { prio: 5 }, {}, 'task')]
    const g = group('and', f('prio', 'greater', 3, 'task'))
    expect(paths(applyFilters(rows, g, ctx()))).toEqual(['a', 't2'])
  })

  test('text contains is case-insensitive; startsWith/endsWith; isEmpty on null and empty', () => {
    const rows = [R('a', { note: 'Hello World' }), R('b', { note: '' }), R('c', { note: null }), R('d')]
    const run = (o: string, v?: string) => paths(applyFilters(rows, group('and', f('note', o, v)), ctx()))
    expect(run('contains', 'WORLD')).toEqual(['a'])
    expect(run('notContains', 'world')).toEqual(['b', 'c', 'd'])
    expect(run('startsWith', 'hello')).toEqual(['a'])
    expect(run('endsWith', 'LD')).toEqual(['a'])
    expect(run('is', 'hello world')).toEqual(['a'])
    expect(run('isNot', 'hello world')).toEqual(['b', 'c', 'd'])
    expect(run('isEmpty')).toEqual(['b', 'c', 'd'])
    expect(run('isNotEmpty')).toEqual(['a'])
  })

  test('text filters with empty reference value pass every row', () => {
    const rows = [R('a', { note: 'Hello' }), R('b', { note: '' }), R('c')]
    for (const o of ['contains', 'notContains', 'is', 'isNot', 'startsWith', 'endsWith']) {
      for (const ref of ['', undefined]) {
        expect(paths(applyFilters(rows, group('and', f('note', o, ref)), ctx()))).toEqual(['a', 'b', 'c'])
      }
    }
  })

  test('title filter uses display title', () => {
    const rows = [R('a', {}, { title: '' }), R('b', {}, { title: 'Real' })]
    expect(paths(applyFilters(rows, group('and', f('title', 'is', 'untitled')), ctx()))).toEqual(['a'])
    expect(paths(applyFilters(rows, group('and', f('title', 'contains', 'rea')), ctx()))).toEqual(['b'])
  })

  test('label contains by option id; notContains true for empty', () => {
    const rows = [R('a', { status: ['Todo'] }), R('b', { status: ['Done'] }), R('c', { status: [] }), R('d')]
    expect(paths(applyFilters(rows, group('and', f('status', 'contains', ['o1'])), ctx()))).toEqual(['a'])
    expect(paths(applyFilters(rows, group('and', f('status', 'contains', ['o1', 'o2'])), ctx()))).toEqual(['a', 'b'])
    expect(paths(applyFilters(rows, group('and', f('status', 'notContains', ['o1'])), ctx()))).toEqual(['b', 'c', 'd'])
    expect(paths(applyFilters(rows, group('and', f('status', 'isEmpty')), ctx()))).toEqual(['c', 'd'])
  })

  test('number operators', () => {
    const rows = [R('a', { qty: 1 }), R('b', { qty: 5 }), R('c', { qty: 9 }), R('d', { qty: null })]
    const run = (o: string, n: number) => paths(applyFilters(rows, group('and', f('qty', o, n)), ctx()))
    expect(run('equal', 5)).toEqual(['b'])
    expect(run('notEqual', 5)).toEqual(['a', 'c', 'd'])
    expect(run('greaterEqual', 5)).toEqual(['b', 'c'])
    expect(run('greater', 5)).toEqual(['c'])
    expect(run('smallerEqual', 5)).toEqual(['a', 'b'])
    expect(run('smaller', 5)).toEqual(['a'])
  })

  test('boolean operators', () => {
    const rows = [R('a', { done: true }), R('b', { done: false }), R('c')]
    expect(paths(applyFilters(rows, group('and', f('done', 'isChecked')), ctx()))).toEqual(['a'])
    expect(paths(applyFilters(rows, group('and', f('done', 'isNotChecked')), ctx()))).toEqual(['b', 'c'])
  })

  test('relative dates against fixed now', () => {
    expect(resolveRelative('thisWeek', now).start).toEqual(new Date(2026, 9, 19))
    expect(resolveRelative('thisWeek', now).end.getDate()).toBe(25)
    const d = (day: string) => ({ start: day, resolution: 'day' as const })
    const rows = [
      R('today', { due: d('2026-10-23') }),
      R('mon', { due: d('2026-10-19') }),
      R('sun', { due: d('2026-10-25') }),
      R('nextMon', { due: d('2026-10-26') }),
      R('old', { due: d('2026-09-01') }),
      R('plus7', { due: d('2026-10-30') }),
      R('none'),
    ]
    const run = (o: string, ref: Filter['referenceValue']) => paths(applyFilters(rows, group('and', f('due', o, ref)), ctx()))
    expect(run('is', { relative: 'today' })).toEqual(['today'])
    expect(run('is', { relative: 'thisWeek' })).toEqual(['today', 'mon', 'sun'])
    expect(run('is', { relative: 'overdue' })).toEqual(['mon', 'old'].sort((a, b) => rows.findIndex((r) => r.summary.path === a) - rows.findIndex((r) => r.summary.path === b)))
    expect(run('is', { relative: 'inOneWeek' })).toEqual(['plus7'])
    expect(run('isOnOrBefore', { exactDate: '2026-10-19' })).toEqual(['mon', 'old'])
    expect(run('isAfter', { relative: 'thisWeek' })).toEqual(['nextMon', 'plus7'])
  })

  test('date range value matches is when the day is inside', () => {
    const rows = [R('r', { due: { start: '2026-10-20', end: '2026-10-26', resolution: 'day' } }), R('x', { due: { start: '2026-11-01', resolution: 'day' } })]
    expect(paths(applyFilters(rows, group('and', f('due', 'is', { exactDate: '2026-10-23' })), ctx()))).toEqual(['r'])
    expect(paths(applyFilters(rows, group('and', f('due', 'endIsNotEmpty')), ctx()))).toEqual(['r'])
    expect(paths(applyFilters(rows, group('and', f('due', 'endIsEmpty')), ctx()))).toEqual(['x'])
  })

  test('collections contains by id via former name', () => {
    const cols = [collection({ id: 'tools', name: 'Tooling', formerNames: ['Gadgets'] }), collection({ id: 'misc', name: 'Misc' })]
    const rows = [
      R('a', {}, { collections: ['tooling'] }),
      R('b', {}, { collections: ['Gadgets'] }),
      R('c', {}, { collections: ['Misc'] }),
      R('d', {}, { collections: ['Unknown'] }),
    ]
    expect(paths(applyFilters(rows, group('and', f('collections', 'contains', ['tools'])), ctx({}, cols)))).toEqual(['a', 'b'])
  })

  test('tags and entities compare by resolved id', () => {
    const rows = [R('a', {}, { tags: ['Alpha'] }), R('b', {}, { tags: ['Beta'] })]
    const c = ctx({ tagIdsToTitles: { t1: 'Alpha' } })
    expect(paths(applyFilters(rows, group('and', f('tags', 'contains', ['t1'])), c))).toEqual(['a'])
    const ent = typeDef({ id: 'page', propertyDefinitions: [...props, propertyDef({ id: 'rel', type: 'entity' })] })
    const er = [row({ summary: objectSummary({ path: 'a' }), values: { rel: [{ target: 'X', path: 'X.md' }] }, links: { rel: ['X.md'] } }), R('b')]
    const ec = ctx({ types: [ent], pathsById: { x1: 'X.md' } })
    expect(paths(applyFilters(er, group('and', f('rel', 'contains', ['x1'])), ec))).toEqual(['a'])
    expect(paths(applyFilters(er, group('and', f('rel', 'isEmpty')), ec))).toEqual(['b'])
  })

  test('matchFilter on a single filter', () => {
    expect(matchFilter(R('a', { note: 'q' }), f('note', 'is', 'q'), ctx())).toBe(true)
  })
})

describe('task date filters (M4)', () => {
  const taskDate = propertyDef({
    id: 'date',
    type: 'datetimeSimple',
    options: { constraints: { resolutionPreference: 'day', endTimeSettings: 'notAllowed', supportsReminders: true } },
  })
  const deadline = propertyDef({ id: 'deadline', type: 'datetimeSimple', options: { constraints: { resolutionPreference: 'day', endTimeSettings: 'notAllowed' } } })
  const taskType = typeDef({
    id: 'task',
    propertyDefinitions: [
      propertyDef({ id: 'title', type: 'entity_title' }),
      taskDate,
      deadline,
      propertyDef({ id: 'repeat', type: 'text', visibility: 'hidden' }),
      propertyDef({ id: 'remind', type: 'text', visibility: 'hidden' }),
    ],
  })
  const tctx = (): FilterCtx => ({ types: [taskType, page], collections: [], tagIdsToTitles: {}, now })
  const day = (s: string) => ({ start: s, resolution: 'day' as const })
  const T = (path: string, values: Row['values'] = {}): Row =>
    R(path, { date: null, repeat: null, remind: null, ...values }, {}, 'task')
  const TASK_OPS = ['isRecurring', 'isNotRecurring', 'hasReminder', 'hasNoReminder']

  test('new options only offered on the Task date property', () => {
    const keys = (d: Pick<PropertyDef, 'type' | 'options'>) => filterOptionsFor(d).map((o) => o.key)
    expect(filterOptionsFor(taskDate).slice(-4).map((o) => `${o.key}:${o.label}`)).toEqual([
      'isRecurring:is recurring',
      'isNotRecurring:is not recurring',
      'hasReminder:has reminder',
      'hasNoReminder:has no reminder',
    ])
    for (const d of [deadline, propertyDef({ id: 'x', type: 'datetime' }), { type: 'entity_createdAt' as const, options: {} }]) {
      expect(keys(d).filter((k) => TASK_OPS.includes(k))).toEqual([])
    }
    // The kind table itself is unchanged: the operators come from the definition.
    expect(FILTER_OPTIONS.datetimeSimple.map((o) => o.key).filter((k) => TASK_OPS.includes(k))).toEqual([])
    expect(filterIsValid(f('date', 'isRecurring'), { task: taskType })).toBe(true)
    expect(filterIsValid(f('deadline', 'isRecurring'), { task: taskType })).toBe(false)
  })

  test('isRecurring and hasReminder filters', () => {
    const rows = [
      T('weekly', { date: day('2026-10-23'), repeat: 'every week' }),
      T('bad', { date: day('2026-10-23'), repeat: 'weekly' }),
      T('nodate', { repeat: 'every day', remind: 'on the day at 09:00' }),
      T('remDay', { date: day('2026-10-23'), remind: '1 day before at 18:30' }),
      T('remMisfit', { date: day('2026-10-23'), remind: '15 minutes before' }),
      T('remTime', { date: { start: '2026-10-23T09:00:00Z', resolution: 'time' }, remind: '1 hour before' }),
      T('plain', { date: day('2026-10-23') }),
    ]
    const run = (o: string) => paths(applyFilters(rows, group('and', f('date', o)), tctx()))
    expect(run('isRecurring')).toEqual(['weekly'])
    expect(run('isNotRecurring')).toEqual(['bad', 'nodate', 'remDay', 'remMisfit', 'remTime', 'plain'])
    expect(run('hasReminder')).toEqual(['remDay', 'remTime'])
    expect(run('hasNoReminder')).toEqual(['weekly', 'bad', 'nodate', 'remMisfit', 'plain'])
  })

  test('task filters on rows of another type', () => {
    const other = R('page', { due: day('2026-10-23') })
    expect(matchFilter(other, f('date', 'isRecurring', undefined, 'task'), tctx())).toBe(true) // another type passes a scoped filter
    expect(matchFilter(other, f('date', 'isRecurring'), tctx())).toBe(false)
    expect(matchFilter(other, f('date', 'isNotRecurring'), tctx())).toBe(true)
    expect(matchFilter(other, f('date', 'hasReminder'), tctx())).toBe(false)
    expect(matchFilter(other, f('date', 'hasNoReminder'), tctx())).toBe(true)
  })
})

describe('backlinks filter (M5)', () => {
  const bl = propertyDef({ id: 'backlinks', name: 'Backlinks', type: 'entity_backlinks' })
  const person = typeDef({ id: 'person', propertyDefinitions: [propertyDef({ id: 'title', type: 'entity_title' }), bl] })
  const bctx = ctx({ types: [person], pathsById: { ada: 'People/Ada.md', bob: 'People/Bob.md' } })
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

  test('test backlinks filter contains and not contains by object', () => {
    expect(FILTER_OPTIONS.entity_backlinks.map((o) => o.key)).toEqual(['contains'])
    expect(rowValue(rows[0], 'backlinks')).toEqual([{ target: 'Ada', path: 'People/Ada.md' }])
    expect(paths(applyFilters(rows, group('and', f('backlinks', 'contains', ['ada'])), bctx))).toEqual(['a', 'b'])
    expect(paths(applyFilters(rows, group('and', f('backlinks', 'contains', ['bob'])), bctx))).toEqual(['b'])
    // A saved "does not include" is evaluated (not offered, not ignored).
    expect(filterIsValid(f('backlinks', 'notContains', ['ada']), { person })).toBe(true)
    expect(paths(applyFilters(rows, group('and', f('backlinks', 'notContains', ['ada'])), bctx))).toEqual(['c'])
    // An empty reference passes every row.
    expect(paths(applyFilters(rows, group('and', f('backlinks', 'contains', [])), bctx))).toEqual(['a', 'b', 'c'])
    // Unknown operators stay invalid.
    expect(filterIsValid(f('backlinks', 'is', 'x'), { person })).toBe(false)
  })
})
