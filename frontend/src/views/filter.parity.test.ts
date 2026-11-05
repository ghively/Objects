// M14: the view filter engine and its server port (`backend/objectapp/automation_filter.py`)
// answer the same shared cases; `backend/tests/test_m14_filter_parity.py` runs this file's
// fixture too.
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { Collection, Filter, FilterGroup, Row, TypeDef } from '@/api/types'
import { settingsDefaults, useSettings } from '@/settings/useSettings'
import { useUiStore } from '@/shell/usePinned'
import cases from './__fixtures__/filter-cases.json'
import { matchFilter, matchGroup, type FilterCtx } from './filter'

interface Case {
  name: string
  /** The space's week start where a case names one; relative weeks run Monday to Sunday anyway. */
  spaceWeekStart?: 'monday' | 'sunday'
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
  const uiBefore = useUiStore.getState().ui
  beforeEach(() => useSettings.setState({ settings: { ...settingsDefaults, timeZone: cases.timeZone } }))
  afterEach(() => {
    useSettings.setState({ settings: settingsDefaults })
    useUiStore.setState({ ui: uiBefore })
  })

  test.each((cases.cases as unknown as Case[]).map((c) => [c.name, c] as const))('%s', (_name, c) => {
    // The space's week start doesn't move relative weeks (a case may name a Sunday-start space).
    const { ui } = useUiStore.getState()
    useUiStore.setState({ ui: { ...ui, calendar: { daily: {}, ...ui.calendar, weekStart: c.spaceWeekStart ?? 'monday' } } })
    const c0 = ctx()
    const got = rows
      .filter((r) => (c.group ? matchGroup(r, c.group, c0) : matchFilter(r, c.filter as Filter, c0)))
      .map((r) => r.summary.path)
    expect(got).toEqual(c.matches)
  })
})
