// M14: the view filter engine and its server port (`backend/objectapp/automation_filter.py`)
// answer the same shared cases; `backend/tests/test_m14_filter_parity.py` runs this file's
// fixture too.
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { Collection, Filter, FilterGroup, Row, TypeDef } from '@/api/types'
import { settingsDefaults, useSettings } from '@/settings/useSettings'
import cases from './__fixtures__/filter-cases.json'
import { matchFilter, matchGroup, type FilterCtx } from './filter'
import type { WeekStart } from './dates'

interface Case {
  name: string
  /** The "Start of the week" setting the case runs under (Monday when absent): relative weeks start on it. */
  weekStart?: WeekStart
  filter?: Filter
  group?: FilterGroup
  matches: string[]
}

const rows = cases.rows as unknown as Row[]

const ctx = (weekStart?: WeekStart): FilterCtx => ({
  types: cases.types as unknown as TypeDef[],
  collections: cases.collections as unknown as Collection[],
  tagIdsToTitles: cases.tagIdsToTitles,
  now: new Date(cases.now),
  pathsById: cases.pathsById,
  weekStart,
})

describe('filter parity with the server', () => {
  beforeEach(() => useSettings.setState({ settings: { ...settingsDefaults, timeZone: cases.timeZone } }))
  afterEach(() => useSettings.setState({ settings: settingsDefaults }))

  test('the fixture covers this week under both week starts', () => {
    const relative = (c: Case) => (c.filter?.referenceValue as { relative?: string } | undefined)?.relative
    const starts = (cases.cases as unknown as Case[]).filter((c) => relative(c) === 'thisWeek').map((c) => c.weekStart)
    expect(starts).toContain('sunday')
    expect(starts).toContain('monday')
  })

  test.each((cases.cases as unknown as Case[]).map((c) => [c.name, c] as const))('%s', (_name, c) => {
    // The engine reads the week start from its context (Monday when the case names none).
    const c0 = ctx(c.weekStart)
    const got = rows
      .filter((r) => (c.group ? matchGroup(r, c.group, c0) : matchFilter(r, c.filter as Filter, c0)))
      .map((r) => r.summary.path)
    expect(got).toEqual(c.matches)
  })
})
