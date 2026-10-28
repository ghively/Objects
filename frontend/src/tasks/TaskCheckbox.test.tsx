import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import type { Row, UpdateResult } from '@/api/types'
import { TaskCheckbox } from './TaskCheckbox'
import { completionToast, type TaskOutcome } from './taskActions'
import { categoryOf } from './statusCategory'
import { TASK_TYPE, taskRow } from './taskFixtures'

const mocked = vi.mocked(api)
const ok = (task?: UpdateResult['task']): UpdateResult => ({ version: 'v2', frontmatter: {}, links: {}, synced: [], skipped: [], task })

/** An owner: holds the row, patches it from the outcome and shows the toast. */
function Owner({ initial, onResult }: { initial: Row; onResult?(o: TaskOutcome): void }) {
  const [row, setRow] = useState(initial)
  const [toast, setToast] = useState<string | null>(null)
  return (
    <div>
      <TaskCheckbox
        row={row}
        type={TASK_TYPE}
        onResult={(o) => {
          onResult?.(o)
          if (o.row) setRow(o.row)
          setToast(completionToast(o))
        }}
      />
      <span data-testid="status">{categoryOf(row, TASK_TYPE)}</span>
      {toast && <div role="status">{toast}</div>}
    </div>
  )
}

beforeEach(() => {
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockReset()
})

describe('TaskCheckbox', () => {
  test('test checkbox completes with row version', async () => {
    const user = userEvent.setup()
    const onResult = vi.fn()
    const fresh = taskRow('Tasks/A.md', { status: ['Done'] }, 'v8')
    mocked.updateProperties.mockResolvedValue(ok({ completed: true, advanced: false }))
    mocked.rows.mockResolvedValue([fresh])
    render(<Owner initial={taskRow('Tasks/A.md', { status: ['Not Started'] }, 'v7')} onResult={onResult} />)
    expect(screen.getByRole('checkbox')).toHaveAttribute('aria-checked', 'false')
    await user.click(screen.getByRole('checkbox'))
    await waitFor(() => expect(onResult).toHaveBeenCalledTimes(1))
    expect(mocked.updateProperties).toHaveBeenCalledTimes(1)
    expect(mocked.updateProperties).toHaveBeenCalledWith('Tasks/A.md', { status: ['Done'] }, 'v7')
    expect(mocked.rows).toHaveBeenCalledTimes(1)
    expect(mocked.rows).toHaveBeenCalledWith({ paths: ['Tasks/A.md'] })
    expect(onResult.mock.calls[0][0].row).toBe(fresh)
    expect(screen.getByTestId('status')).toHaveTextContent('done')
    expect(screen.getByRole('checkbox')).toHaveAttribute('aria-checked', 'true')
  })

  test('test checkbox reopen goes to first not-started option', async () => {
    const user = userEvent.setup()
    mocked.updateProperties.mockResolvedValue(ok({ completed: false, advanced: false }))
    mocked.rows.mockResolvedValue([taskRow('Tasks/A.md', { status: ['Not Started'] }, 'v3')])
    render(<Owner initial={taskRow('Tasks/A.md', { status: ['Done'] }, 'v2')} />)
    await user.click(screen.getByRole('checkbox'))
    await waitFor(() => expect(mocked.updateProperties).toHaveBeenCalledWith('Tasks/A.md', { status: ['Not Started'] }, 'v2'))
  })

  test('test menu groups options by category in order', async () => {
    const user = userEvent.setup()
    mocked.updateProperties.mockResolvedValue(ok(null))
    mocked.rows.mockResolvedValue([])
    render(<Owner initial={taskRow('Tasks/A.md', { status: [] })} />)
    await user.click(screen.getByRole('button', { name: 'Status' }))
    const menu = await screen.findByRole('menu', { name: 'Status' })
    const groups = within(menu).getAllByRole('group')
    expect(groups.map((g) => g.getAttribute('aria-label'))).toEqual(['Not started', 'In progress', 'Blocked', 'Done'])
    expect(within(groups[0]).getAllByRole('menuitem').map((b) => b.textContent)).toEqual(['Not StartedOpen', 'Next Up'])
    await user.click(within(groups[2]).getByRole('menuitem', { name: /On Hold/ }))
    await waitFor(() => expect(mocked.updateProperties).toHaveBeenCalledWith('Tasks/A.md', { status: ['On Hold'] }, 'v1'))
  })

  test('ctrl-click opens the menu instead of toggling', async () => {
    const user = userEvent.setup()
    render(<Owner initial={taskRow('Tasks/A.md', { status: [] })} />)
    await user.keyboard('{Control>}')
    await user.click(screen.getByRole('checkbox'))
    await user.keyboard('{/Control}')
    expect(await screen.findByRole('menu', { name: 'Status' })).toBeInTheDocument()
    expect(mocked.updateProperties).not.toHaveBeenCalled()
  })

  test('test recurring completion toast shows next date', async () => {
    const user = userEvent.setup()
    mocked.updateProperties.mockResolvedValue(ok({ completed: true, advanced: true, date: { start: '2026-10-28', resolution: 'day' } }))
    mocked.rows.mockResolvedValue([
      taskRow('Tasks/A.md', { status: ['Not Started'], date: { start: '2026-10-28', resolution: 'day' }, repeat: 'every 2 days' }, 'v5'),
    ])
    render(<Owner initial={taskRow('Tasks/A.md', { status: ['Not Started'], date: { start: '2026-10-26', resolution: 'day' }, repeat: 'every 2 days' }, 'v4')} />)
    await user.click(screen.getByRole('checkbox'))
    expect(await screen.findByRole('status')).toHaveTextContent('Moved to 2026-10-28')
    expect(screen.getByTestId('status')).toHaveTextContent('not-started')
    expect(screen.getByRole('checkbox')).toHaveAttribute('aria-checked', 'false')
  })
})
