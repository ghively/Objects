// M32, item 13: a task's circle on a type with no done status offers "Add a Done status" (one
// click adds it through the type API and completes the task) instead of "This type has no status
// for that."
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import type { TypeDef, UpdateResult } from '@/api/types'
import { resetLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { ADD_DONE_TEXT, TaskCheckbox } from './TaskCheckbox'
import { DONE_STATUS, lacksDoneStatus } from './taskActions'
import { TASK_TYPE, taskRow } from './taskFixtures'

const mocked = vi.mocked(api)
const ok = (task?: UpdateResult['task']): UpdateResult => ({ version: 'v2', frontmatter: {}, links: {}, synced: [], skipped: [], task })

/** The Task type with no status in the Done category. */
const NO_DONE: TypeDef = {
  ...TASK_TYPE,
  revision: 'r1',
  propertyDefinitions: TASK_TYPE.propertyDefinitions.map((d) =>
    d.key === 'status' ? { ...d, options: { ...d.options, set: (d.options.set ?? []).filter((o) => o.statusCategory !== 'done') } } : d,
  ),
}

beforeEach(() => {
  resetLinkIndex()
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockReset()
  useLinkIndex.setState({ types: [NO_DONE], objects: [], loaded: true })
})

describe('TaskCheckbox on a type with no done status (M32)', () => {
  test('test the tick offers Add a Done status, which adds it through the type API and completes the task', async () => {
    const user = userEvent.setup()
    const onResult = vi.fn()
    mocked.saveType.mockImplementation(async (type) => ({ type: { ...type, revision: 'r2' }, rewritten: [], skipped: [] }))
    mocked.updateProperties.mockResolvedValue(ok({ completed: true, advanced: false }))
    mocked.rows.mockResolvedValue([taskRow('Tasks/A.md', { status: ['Done'] }, 'v2')])
    expect(lacksDoneStatus(NO_DONE)).toBe(true)
    render(<TaskCheckbox row={taskRow('Tasks/A.md', { status: ['Not Started'] }, 'v1')} type={NO_DONE} onResult={onResult} />)

    await user.click(screen.getByRole('checkbox'))
    // Nothing is written by the tick itself, and the old dead end is not shown.
    expect(mocked.updateProperties).not.toHaveBeenCalled()
    expect(onResult).not.toHaveBeenCalled()
    expect(screen.queryByText('This type has no status for that.')).toBeNull()
    expect(await screen.findByText(ADD_DONE_TEXT.hint)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Add a Done status' }))
    await waitFor(() => expect(mocked.saveType).toHaveBeenCalledTimes(1))
    const [saved, opts] = mocked.saveType.mock.calls[0]
    expect(opts).toEqual({ baseRevision: 'r1' })
    const set = saved.propertyDefinitions.find((d) => d.key === 'status')?.options.set ?? []
    expect(set.map((o) => o.text)).toEqual(['Not Started', 'Next Up', 'In Progress', 'On Hold', 'Done'])
    expect(set[set.length - 1]).toMatchObject(DONE_STATUS)
    // Every other property is sent as it was.
    expect(saved.propertyDefinitions.filter((d) => d.key !== 'status')).toEqual(NO_DONE.propertyDefinitions.filter((d) => d.key !== 'status'))
    // The saved type is in the index, and the task is completed with the new status.
    await waitFor(() => expect(mocked.updateProperties).toHaveBeenCalledWith('Tasks/A.md', { status: ['Done'] }, 'v1'))
    expect(lacksDoneStatus(useLinkIndex.getState().types[0])).toBe(false)
    expect(useLinkIndex.getState().types[0].revision).toBe('r2')
    await waitFor(() => expect(onResult).toHaveBeenCalledTimes(1))
    expect(onResult.mock.calls[0][0]).toMatchObject({ conflict: false, result: { completed: true } })
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Add a Done status' })).toBeNull())
  })

  test('a refused type save shows why and completes nothing', async () => {
    const user = userEvent.setup()
    mocked.saveType.mockRejectedValue(new Error('The type was changed elsewhere.'))
    render(<TaskCheckbox row={taskRow('Tasks/A.md', { status: ['Not Started'] }, 'v1')} type={NO_DONE} />)
    await user.click(screen.getByRole('checkbox'))
    await user.click(await screen.findByRole('button', { name: 'Add a Done status' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The type was changed elsewhere.')
    expect(mocked.updateProperties).not.toHaveBeenCalled()
  })

  test('a type with a done status, and a read-only task, get no offer', async () => {
    const user = userEvent.setup()
    mocked.updateProperties.mockResolvedValue(ok({ completed: true, advanced: false }))
    mocked.rows.mockResolvedValue([taskRow('Tasks/A.md', { status: ['Done'] }, 'v2')])
    const { unmount } = render(<TaskCheckbox row={taskRow('Tasks/A.md', { status: ['Not Started'] }, 'v1')} type={TASK_TYPE} />)
    await user.click(screen.getByRole('checkbox'))
    await waitFor(() => expect(mocked.updateProperties).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('button', { name: 'Add a Done status' })).toBeNull()
    unmount()

    const locked = taskRow('Tasks/B.md', { status: ['Not Started'] }, 'v1')
    render(<TaskCheckbox row={{ ...locked, summary: { ...locked.summary, readOnly: true } }} type={NO_DONE} />)
    expect(screen.getByRole('checkbox')).toBeDisabled()
  })
})
