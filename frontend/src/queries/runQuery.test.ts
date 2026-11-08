import { describe, expect, test } from 'vitest'
import type { QueryDefinition, Row } from '@/api/types'
import { collection, objectSummary, propertyDef, row, typeDef } from '@/test/mockApi'
import { emptyFilterGroup } from '@/views/model'
import type { GroupCtx } from '@/views/group'
import { isQueryReady, isSearching, queryScope, runQuery } from './runQuery'

const TITLE = propertyDef({ id: 'title', key: 'title', name: 'Title', type: 'entity_title' })
const SERVER = typeDef({ id: 'server', name: 'Server', pluralName: 'Servers', propertyDefinitions: [TITLE] })
const PAGE = typeDef({ id: 'page', name: 'Page', pluralName: 'Pages', propertyDefinitions: [TITLE] })
const TOOLING = collection({ id: 'tooling', name: 'Tooling', formerNames: ['Gear'], typeIds: ['server'] })
const OPS = collection({ id: 'ops', name: 'Ops', typeIds: ['server', 'page'] })

const ctx: GroupCtx = {
  types: [SERVER, PAGE],
  collections: [TOOLING, OPS],
  tagIdsToTitles: { 'tag-a': 'alpha', 'tag-b': 'beta' },
  now: new Date(2026, 9, 26, 12, 0),
}

let n = 0
const R = (title: string, type: string, over: Partial<Row['summary']> = {}): Row => {
  n += 1
  return row({
    summary: objectSummary({ path: `${type}/${title}.md`, type, title, createdAt: `2026-01-0${(n % 9) + 1}T00:00:00Z`, ...over }),
  })
}

const def = (over: Partial<QueryDefinition> = {}): QueryDefinition => ({
  types: [],
  filterGroup: emptyFilterGroup(),
  sorts: [],
  groupBy: null,
  ...over,
})
const titles = (rows: Row[]) => rows.map((r) => r.summary.title)

describe('runQuery', () => {
  test('test runQuery collection filters per type', () => {
    const rows = [
      R('A', 'server', { collections: ['Tooling'] }),
      R('B', 'server', { collections: ['Unknown'] }),
      R('C', 'server'),
      R('D', 'server', { collections: ['Gear', 'Ops'] }),
      R('P', 'page', { collections: ['Ops'] }),
    ]
    const run = (s: QueryDefinition['types'][number]) => titles(runQuery(def({ types: [s] }), rows, ctx).rows).sort()
    expect(run({ id: 'server', inNoCollection: true })).toEqual(['B', 'C'])
    expect(run({ id: 'server', inAnyCollection: true })).toEqual(['A', 'D'])
    expect(run({ id: 'server', collectionIds: ['tooling'] })).toEqual(['A', 'D'])
    expect(run({ id: 'server', excludeCollectionIds: ['ops'] })).toEqual(['A', 'B', 'C'])
    // A type that is not among the query types is left out.
    expect(titles(runQuery(def({ types: [{ id: 'server', inNoCollection: true }] }), rows, ctx).rows)).not.toContain('P')
  })

  test('test tags any vs all', () => {
    const rows = [R('A', 'page', { tags: ['alpha'] }), R('B', 'page', { tags: ['beta'] }), R('C', 'page', { tags: ['alpha', 'beta'] }), R('D', 'page')]
    const tags = (operator: 'or' | 'and') => titles(runQuery(def({ tags: { ids: ['tag-a', 'tag-b'], operator } }), rows, ctx).rows).sort()
    expect(tags('or')).toEqual(['A', 'B', 'C'])
    expect(tags('and')).toEqual(['C'])
  })

  test('test excludeTags removes tagged rows', () => {
    const rows = [R('A', 'page', { tags: ['alpha'] }), R('B', 'page', { tags: ['beta'] }), R('C', 'page')]
    const out = runQuery(
      def({ types: [{ id: 'page' }], tags: { ids: ['tag-a', 'tag-b'], operator: 'or' }, excludeTags: { ids: ['tag-b'] } }),
      rows,
      ctx,
    )
    expect(titles(out.rows)).toEqual(['A'])
  })

  test('test excludeTags and excluded types ignored without search or tag', () => {
    const rows = [R('A', 'page', { tags: ['alpha'] }), R('S', 'server')]
    const d = def({ types: [{ id: 'page' }], excludeTags: { ids: ['tag-a'] } })
    expect(titles(runQuery(d, rows, ctx).rows)).toEqual(['A'])
    const e = def({ excludeTypeIds: ['page'] })
    expect(titles(runQuery(e, rows, ctx).rows).sort()).toEqual(['A', 'S'])
    expect(queryScope(e, ['page', 'server'])).toEqual({})
    // With a search term the exclusion counts.
    const f = def({ excludeTypeIds: ['page'], search: { searchTerms: [{ text: 'zz' }], searchMode: 'auto' } })
    expect(titles(runQuery(f, rows, ctx).rows)).toEqual(['S'])
    expect(queryScope(f, ['page', 'server'])).toEqual({ typeIds: ['server'], search: { terms: ['zz'], mode: 'auto' } })
  })

  test('test limit first and random with seeded rng, ignored when grouped', () => {
    const rows = ['A', 'B', 'C', 'D', 'E'].map((t, i) => R(t, 'page', { createdAt: `2026-01-0${5 - i}T00:00:00Z` }))
    const base = { types: [{ id: 'page' }] }
    expect(titles(runQuery(def({ ...base, limit: { size: 2 } }), rows, ctx).rows)).toEqual(['A', 'B'])
    const seq = [0.99, 0, 0.5]
    let i = 0
    const rng = () => seq[i++ % seq.length]
    const random = runQuery(def({ ...base, limit: { size: 2, random: true } }), rows, ctx, rng)
    expect(random.rows).toHaveLength(2)
    expect(titles(random.rows)).toEqual(['E', 'A'])
    const grouped = runQuery(
      def({ ...base, limit: { size: 2 }, groupBy: { groups: [{ propertyId: 'title', option: 'default' }] } as never }),
      rows,
      ctx,
    )
    expect(grouped.rows).toHaveLength(5)
  })

  test('test search pauses filters and sorts', () => {
    const rows = [
      R('Alpha', 'page', { createdAt: '2026-01-01T00:00:00Z' }),
      R('Beta', 'page', { createdAt: '2026-03-01T00:00:00Z' }),
      R('Gamma', 'page', { createdAt: '2026-02-01T00:00:00Z' }),
    ]
    const base = def({
      types: [{ id: 'page' }],
      filterGroup: { type: 'filterGroup', operator: 'and', elements: [{ type: 'filter', propertyId: 'title', option: 'isNot', referenceValue: 'Alpha' }] },
      sorts: [{ propertyId: 'title', option: 'descending' }],
    })
    const plain = runQuery(base, rows, ctx)
    expect(titles(plain.rows)).toEqual(['Gamma', 'Beta'])
    expect(plain.paused).toBe(false)
    const searching = { ...base, search: { searchTerms: [{ text: 'al' }], searchMode: 'auto' as const } }
    expect(isSearching(searching)).toBe(true)
    const out = runQuery(searching, rows, ctx)
    expect(titles(out.rows)).toEqual(['Beta', 'Gamma', 'Alpha'])
    expect(out.paused).toBe(true)
    // The stored filters and sorts are untouched.
    expect(searching.sorts).toHaveLength(1)
    expect(searching.filterGroup.elements).toHaveLength(1)
  })

  test('isQueryReady needs a search term, a tag or a type; queryScope sends the types and terms', () => {
    expect(isQueryReady(def())).toBe(false)
    expect(isQueryReady(def({ types: [{ id: 'page' }] }))).toBe(true)
    expect(isQueryReady(def({ tags: { ids: ['tag-a'], operator: 'or' } }))).toBe(true)
    expect(isQueryReady(def({ search: { searchTerms: [{ text: 'x' }], searchMode: 'auto' } }))).toBe(false)
    expect(isQueryReady(def({ search: { searchTerms: [{ text: 'xy' }], searchMode: 'title' } }))).toBe(true)
    expect(
      queryScope(def({ types: [{ id: 'page' }, { id: 'server' }], search: { searchTerms: [{ text: 'xy' }], searchMode: 'title' } })),
    ).toEqual({ typeIds: ['page', 'server'], search: { terms: ['xy'], mode: 'title' } })
  })
})
