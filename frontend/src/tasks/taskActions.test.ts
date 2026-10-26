import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api, ConflictError } from '@/api/client'
import type { UpdateResult } from '@/api/types'
import { completionToast, setStatus, toggleDone } from './taskActions'
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
})
