// M14: the view filter engine and its server port (`backend/objectapp/automation_filter.py`)
// answer the same shared cases; `backend/tests/test_m14_filter_parity.py` runs this file's
// fixture too.
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { Collection, Filter, FilterGroup, Row, TypeDef } from '@/api/types'
import { settingsDefaults, useSettings } from '@/settings/useSettings'
import cases from './__fixtures__/filter-cases.json'
import { matchFilter, matchGroup, type FilterCtx } from './filter'

interface Case {
  name: string
  filter?: Filter
  group?: FilterGroup
  matches: string[]
}

const rows = cases.rows as unknown as Row[]

const ctx = (): FilterCtx => ({
  types: cases.types as unknown as TypeDef[],
  collections: cases.collections as unknown as Collection[],
  tagIdsToTitles: cases.tagIdsToTitles,
  now: new Date(cases.now),
  pathsById: cases.pathsById,
})

describe('filter parity with the server', () => {
  beforeEach(() => useSettings.setState({ settings: { ...settingsDefaults, timeZone: cases.timeZone } }))
  afterEach(() => useSettings.setState({ settings: settingsDefaults }))

  test.each((cases.cases as unknown as Case[]).map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const c0 = ctx()
    const got = rows
      .filter((r) => (c.group ? matchGroup(r, c.group, c0) : matchFilter(r, c.filter as Filter, c0)))
      .map((r) => r.summary.path)
    expect(got).toEqual(c.matches)
  })
})
