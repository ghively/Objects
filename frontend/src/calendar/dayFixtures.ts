// Test fixtures for the Day view tests (Task 13): types, rows and a mocked calendar range.
// Imported by tests only.
import { vi } from 'vitest'
import { api } from '@/api/client'
import type { CalendarDay, ChangeEvent, Row, TypeDef } from '@/api/types'
import { resetLinkIndex } from '@/links/linkIndex'
import { useTabs, usePeek } from '@/nav/tabs'
import { resetPinned, useUiStore } from '@/shell/usePinned'
import { TASK_TYPE } from '@/tasks/taskFixtures'
import { calendarDay, calendarRange, objectDetail, objectSummary, propertyDef, row, typeDef } from '@/test/mockApi'

export const TODAY = '2026-10-23'

const dateProp = (key: string) =>
  propertyDef({ id: key, key, type: 'datetimeSimple', name: key, options: { constraints: { resolutionPreference: 'day' } } })

export const MEETING = typeDef({ id: 'meeting', name: 'Meeting', pluralName: 'Meetings', propertyDefinitions: [dateProp('when')] })
export const JOURNAL = typeDef({
  id: 'journal',
  name: 'Journal',
  pluralName: 'Journals',
  createInCalendarOption: 'createOnce',
  propertyDefinitions: [dateProp('day')],
})
export const HIDDEN = typeDef({
  id: 'secret',
  name: 'Secret',
  pluralName: 'Secrets',
  createInCalendarOption: 'disabled',
  propertyDefinitions: [dateProp('on')],
})
export const PAGE = typeDef({ id: 'page', name: 'Page', pluralName: 'Pages' })
export const DAILYNOTE = typeDef({
  id: 'dailynote',
  name: 'Daily Note',
  pluralName: 'Daily Notes',
  propertyDefinitions: [dateProp('date'), propertyDef({ id: 'reviewed', type: 'boolean', name: 'Reviewed' })],
})
export const ALL_TYPES: TypeDef[] = [TASK_TYPE, MEETING, JOURNAL, HIDDEN, PAGE, DAILYNOTE]

export const mocked = vi.mocked(api)

export let listeners: ((e: ChangeEvent) => void)[] = []

/** The days the mocked `api.calendar` answers with (others are empty). */
export let days: Record<string, CalendarDay> = {}
/** The rows the mocked `api.rows` answers with, by path. */
export let rowsByPath: Record<string, Row> = {}

export function setDay(day: string, cd: Partial<CalendarDay>) {
  days = { ...days, [day]: calendarDay(cd) }
}

export function setRows(rs: Row[]) {
  rowsByPath = { ...rowsByPath, ...Object.fromEntries(rs.map((r) => [r.summary.path, r])) }
}

export const pageRow = (path: string, type = 'page'): Row => row({ summary: objectSummary({ path, type }) })

export function resetDayMocks(types: TypeDef[] = ALL_TYPES) {
  localStorage.clear()
  resetLinkIndex()
  resetPinned()
  useUiStore.setState({ loaded: true, revision: 'r0' })
  useTabs.getState().reset()
  usePeek.getState().close()
  listeners = []
  days = {}
  rowsByPath = {}
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockReset()
  mocked.space.mockResolvedValue({ name: 's', root: '/s', types })
  mocked.objects.mockResolvedValue([])
  mocked.resolve.mockResolvedValue(null)
  mocked.calendar.mockImplementation(async (from, to) => {
    const summaries: Record<string, ReturnType<typeof objectSummary>> = {}
    for (const r of Object.values(rowsByPath)) summaries[r.summary.path] = r.summary
    return calendarRange({ from, to, today: TODAY, days: { ...days }, summaries })
  })
  mocked.rows.mockImplementation(async (scope = {}) => (scope.paths ?? []).map((p) => rowsByPath[p]).filter((r): r is Row => !!r))
  mocked.object.mockImplementation(async (path: string) =>
    objectDetail({ summary: objectSummary({ path, type: 'dailynote' }), body: '', version: 'v1' }),
  )
  mocked.saveBody.mockImplementation(async () => ({ version: 'v2' }))
  mocked.updateProperties.mockImplementation(async (_p, updates, base) => ({
    version: `${base}+1`,
    frontmatter: { ...updates },
    links: {},
    synced: [],
    skipped: [],
  }))
  mocked.createObject.mockImplementation(async (typeId: string) => ({ path: `${typeId}/Untitled.md`, version: 'v1' }))
  mocked.createDailyNote.mockImplementation(async (date: string) => ({ path: `DailyNotes/${date}.md`, version: 'v1', typeIds: [] }))
  mocked.ui.mockResolvedValue({ ui: { pinned: [], sections: [], allNotesLayout: 'list' }, revision: 'r0' })
  mocked.patchUi.mockImplementation(async (patch) => ({
    ui: { pinned: [], sections: [], allNotesLayout: 'list', ...patch },
    revision: 'r1',
  }))
  mocked.onChange.mockImplementation((cb: (e: ChangeEvent) => void) => {
    listeners.push(cb)
    return () => {
      listeners = listeners.filter((l) => l !== cb)
    }
  })
}
