// Polish item 21: each "Add new object type" template comes with one saved query. The fixture is
// written by the backend (`test_typetemplates.py`, from the template table); here every query is
// evaluated on rows of its type to show it picks what its name says.
import { describe, expect, test } from 'vitest'
import type { PropertyDef, QueryDefinition, Row } from '@/api/types'
import { objectSummary, propertyDef, row, typeDef } from '@/test/mockApi'
import type { GroupCtx } from '@/views/group'
import { runQuery } from '@/queries/runQuery'
import fixture from './templateQueries.fixture.json'

interface Entry {
  properties: { key: string; name: string; type: string; options: Record<string, unknown> }[]
  query: { name: string; definition: QueryDefinition; view: { viewDefinition: { dataViewLayout: string } } }
}
const TEMPLATES = fixture as unknown as Record<string, Entry>

const day = (start: string, end?: string | null) => ({ start, ...(end !== undefined ? { end } : {}), resolution: 'day' })

type Values = Record<string, unknown>
type Summary = Partial<Row['summary']>

/** Per template: rows that must match (in order) and rows that must not. */
const CASES: Record<string, { hit: [string, Values, Summary?][]; miss: [string, Values, Summary?][] }> = {
  meeting: { hit: [['Standup', { date: day('2026-11-05') }]], miss: [['Kickoff', { date: day('2026-10-01') }], ['Undated', {}]] },
  person: { hit: [['Ada', { category: ['Colleague'] }]], miss: [['Mum', { category: ['Family'] }]] },
  project: { hit: [['Rollout', { status: ['In Progress'] }]], miss: [['Archive', { status: ['Completed'] }]] },
  atomicNote: {
    hit: [
      ['Newer', {}, { lastUpdated: '2026-11-03T10:00:00Z' }],
      ['Older', {}, { lastUpdated: '2026-11-01T10:00:00Z' }],
    ],
    miss: [],
  },
  definition: { hit: [['Alpha', {}], ['Zeta', {}]], miss: [] },
  book: {
    hit: [['Dune', { readingTimeline: day('2026-10-01', null) }]],
    miss: [['Emma', { readingTimeline: day('2026-01-01', '2026-02-01') }], ['Unread', {}]],
  },
  film: { hit: [['Heat', { rating: 5 }], ['Alien', { rating: 4 }]], miss: [['Flop', { rating: 2 }], ['Unrated', {}]] },
  tvSeries: { hit: [['Andor', { watchedOn: day('2026-03-01') }]], miss: [['Lost', { watchedOn: day('2025-03-01') }]] },
  podcast: { hit: [['Episode', { listenedOn: day('2026-11-02') }]], miss: [['Old', { listenedOn: day('2026-09-02') }]] },
  week: {
    hit: [['Week 46', { period: day('2026-11-09', '2026-11-15') }]],
    miss: [['Week 32', { period: day('2026-08-03', '2026-08-09') }]],
  },
  month: {
    hit: [['February', { period: day('2026-02-01', '2026-02-28') }]],
    miss: [['Last year', { period: day('2025-02-01', '2025-02-28') }]],
  },
  organization: { hit: [['Acme', { category: ['Company'] }]], miss: [['College', { category: ['University'] }]] },
  area: { hit: [['Health', {}], ['Work', {}]], miss: [] },
}

const NOW = new Date(2026, 10, 4, 12, 0) // Wednesday 2026-11-04

describe('the starter templates’ saved queries', () => {
  test('every gallery template has a query and a case here', () => {
    expect(Object.keys(TEMPLATES).sort()).toEqual(Object.keys(CASES).sort())
    expect(Object.keys(TEMPLATES)).toHaveLength(13)
  })

  test.each(Object.keys(CASES))('%s: the query picks its objects', (key) => {
    const entry = TEMPLATES[key]
    const defs = entry.properties.map((p) => propertyDef({ id: p.key, ...p } as Partial<PropertyDef> & { id: string }))
    const type = typeDef({ id: key, propertyDefinitions: defs })
    const other = typeDef({ id: 'other', propertyDefinitions: defs })
    const mk = (typeId: string) => ([title, values, summary]: [string, Values, Summary?]): Row =>
      row({ summary: objectSummary({ path: `${typeId}/${title}.md`, type: typeId, title, ...summary }), values })
    const c = CASES[key]
    // The misses first and the hits in reverse, so the sort shows too.
    const rows = [...c.miss.map(mk(key)), ...[...c.hit].reverse().map(mk(key)), ...c.hit.map(mk('other'))]
    const ctx: GroupCtx = { types: [type, other], collections: [], tagIdsToTitles: {}, now: NOW }
    const out = runQuery(entry.query.definition, rows, ctx)
    expect(out.rows.map((r) => `${r.summary.type}/${r.summary.title}`)).toEqual(c.hit.map(([t]) => `${key}/${t}`))
  })
})
