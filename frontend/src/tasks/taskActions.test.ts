import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api, ConflictError } from '@/api/client'
import type { UpdateResult } from '@/api/types'
import { settingsDefaults, useSettings } from '@/settings/useSettings'
import { completionToast, dateRemovalOf, maybeOverdue, setDate, setStatus, toggleDone } from './taskActions'
import { TASK_TYPE, taskRow } from './taskFixtures'

const mocked = vi.mocked(api)
const result = (task?: UpdateResult['task']): UpdateResult => ({ version: 'v2', frontmatter: {}, links: {}, synced: [], skipped: [], task })

beforeEach(() => {
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockReset()
})

describe('taskActions', () => {
  test('setStatus writes once with the row version, then reloads the row once', async () => {
    const row = taskRow('Tasks/A.md', { status: ['Not Started'] }, 'v7')
    const fresh = taskRow('Tasks/A.md', { status: ['Done'] }, 'v8')
    mocked.updateProperties.mockResolvedValue(result({ completed: true, advanced: false }))
    mocked.rows.mockResolvedValue([fresh])
    const out = await setStatus(api, row, TASK_TYPE, 'Done')
    expect(mocked.updateProperties).toHaveBeenCalledTimes(1)
    expect(mocked.updateProperties).toHaveBeenCalledWith('Tasks/A.md', { status: ['Done'] }, 'v7')
    expect(mocked.rows).toHaveBeenCalledTimes(1)
    expect(mocked.rows).toHaveBeenCalledWith({ paths: ['Tasks/A.md'] })
    expect(out).toEqual({ result: { completed: true, advanced: false }, row: fresh, conflict: false })
  })

  test('a 409 reloads without retry', async () => {
    const row = taskRow('Tasks/A.md', { status: [] }, 'v1')
    mocked.updateProperties.mockRejectedValue(new ConflictError('v9'))
    mocked.rows.mockResolvedValue([taskRow('Tasks/A.md', { status: ['In Progress'] }, 'v9')])
    const out = await toggleDone(api, row, TASK_TYPE)
    expect(mocked.updateProperties).toHaveBeenCalledTimes(1)
    expect(mocked.rows).toHaveBeenCalledTimes(1)
    expect(out.conflict).toBe(true)
    expect(out.row?.version).toBe('v9')
    expect(completionToast(out)).toBe('Changed elsewhere. Reloaded.')
  })

  test('toggleDone: open goes to first done option, done to first not-started option', async () => {
    mocked.updateProperties.mockResolvedValue(result(null))
    mocked.rows.mockResolvedValue([])
    await toggleDone(api, taskRow('Tasks/A.md', { status: ['Next Up'] }), TASK_TYPE)
    expect(mocked.updateProperties).toHaveBeenLastCalledWith('Tasks/A.md', { status: ['Done'] }, 'v1')
    await toggleDone(api, taskRow('Tasks/A.md', { status: ['Done'] }), TASK_TYPE)
    expect(mocked.updateProperties).toHaveBeenLastCalledWith('Tasks/A.md', { status: ['Not Started'] }, 'v1')
  })

  test('completionToast: "Moved to {date}" only after an advance', () => {
    expect(completionToast({ result: { completed: true, advanced: true, date: { start: '2026-10-28', resolution: 'day' } }, row: undefined, conflict: false })).toBe(
      'Moved to 2026-10-28',
    )
    expect(completionToast({ result: { completed: true, advanced: false }, row: undefined, conflict: false })).toBeNull()
    expect(completionToast({ result: undefined, row: undefined, conflict: false })).toBeNull()
  })

  test('test maybe overdue uses the time zone setting', () => {
    // 02:00 UTC on Oct 28: still Oct 27 in Los Angeles, already Oct 28 (16:00) on Kiritimati.
    const now = new Date('2026-10-28T02:00:00Z')
    const setZone = (timeZone: string | null) => useSettings.setState({ settings: { ...settingsDefaults, timeZone } })
    const dayTask = taskRow('Tasks/W.md', { repeat: 'every day', date: { start: '2026-10-27', resolution: 'day' } })
    const timeTask = taskRow('Tasks/T.md', { repeat: 'every day', date: { start: '2026-10-27T09:00:00Z', resolution: 'time' } })
    try {
      setZone('America/Los_Angeles')
      expect(maybeOverdue(dayTask, now)).toBe(false) // today is the task's day
      expect(maybeOverdue(timeTask, now)).toBe(false) // 02:00 on Oct 27 there
      setZone('Pacific/Kiritimati')
      expect(maybeOverdue(dayTask, now)).toBe(true)
      expect(maybeOverdue(timeTask, now)).toBe(true) // 23:00 on Oct 27 there, today is Oct 28
      // Not recurring, or by completion date: never.
      expect(maybeOverdue(taskRow('Tasks/X.md', { date: { start: '2026-10-01', resolution: 'day' } }), now)).toBe(false)
      expect(maybeOverdue(taskRow('Tasks/Y.md', { repeat: 'every day after completion', date: { start: '2026-10-01', resolution: 'day' } }), now)).toBe(false)
    } finally {
      setZone(null)
    }
  })
})

// M33 (choice 9): removing a task's date from a row is the pane's "Remove date".
describe('removing a task date (M33)', () => {
  const day = (start: string) => ({ start, resolution: 'day' as const })
  const ok: UpdateResult = { version: 'v2', frontmatter: {}, links: {}, synced: [], skipped: [], task: null }

  test('test dateRemovalOf names what goes with the date and whether there is history to ask about', () => {
    expect(dateRemovalOf(taskRow('Tasks/A.md', { date: day('2026-10-23') }))).toEqual({ updates: { date: null }, remove: [], hasHistory: false })
    expect(dateRemovalOf(taskRow('Tasks/A.md', { date: day('2026-10-23'), repeat: 'every week', remind: 'on the day at 09:00' }))).toEqual({
      updates: { date: null },
      remove: ['repeat', 'remind'],
      hasHistory: false,
    })
    expect(dateRemovalOf(taskRow('Tasks/A.md', { date: day('2026-10-23'), repeat: 'every week', occurrenceLog: '2026-10-16 skipped' }))).toEqual({
      updates: { date: null },
      remove: ['repeat', 'occurrenceLog'],
      hasHistory: true,
    })
    // A blank log is no history; a task with no date has nothing to write.
    expect(dateRemovalOf(taskRow('Tasks/A.md', { date: day('2026-10-23'), occurrenceLog: '  ' })).hasHistory).toBe(false)
    expect(dateRemovalOf(taskRow('Tasks/A.md', {}))).toEqual({ updates: {}, remove: [], hasHistory: false })
    // A repeat left behind by an earlier "No date" goes on the next one.
    expect(dateRemovalOf(taskRow('Tasks/A.md', { repeat: 'every week' }))).toEqual({ updates: {}, remove: ['repeat'], hasHistory: false })
  })

  test('test setDate(null) makes that one write; a date still writes the date alone', async () => {
    const updateProperties = vi.fn(async () => ok)
    const rows = vi.fn(async () => [])
    const taskApi = { updateProperties, rows }
    await setDate(taskApi, taskRow('Tasks/A.md', { date: day('2026-10-23'), repeat: 'every week' }, 'v1'), null)
    expect(updateProperties.mock.calls[0]).toEqual(['Tasks/A.md', { date: null }, 'v1', ['repeat']])
    await setDate(taskApi, taskRow('Tasks/A.md', { date: day('2026-10-23'), repeat: 'every week' }, 'v1'), day('2026-10-24'))
    expect(updateProperties.mock.calls[1]).toEqual(['Tasks/A.md', { date: day('2026-10-24') }, 'v1'])
    // Nothing to remove: no write and no reload.
    updateProperties.mockClear()
    rows.mockClear()
    const outcome = await setDate(taskApi, taskRow('Tasks/A.md', {}, 'v1'), null)
    expect(updateProperties).not.toHaveBeenCalled()
    expect(rows).not.toHaveBeenCalled()
    expect(outcome).toEqual({ result: undefined, row: undefined, conflict: false })
  })
})
