import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api, ConflictError } from '@/api/client'
import type { Row, UpdateResult, ViewState } from '@/api/types'
import { resetLinkIndex } from '@/links/linkIndex'
import { DataView } from '@/views/DataView'
import { emptyFilterGroup } from '@/views/model'
import { completionToast } from './taskActions'
import { TASK_TYPE, taskRow } from './taskFixtures'
import { taskRowExtras } from './taskRowExtras'

const mocked = vi.mocked(api)
const TODAY = new Date(2026, 9, 26)

/** An owner page: rows in state, `patchRow` from the outcome, the toast under the view. */
function Owner({ initial, badges }: { initial: Row[]; badges?: ('date' | 'deadline' | 'occurrence' | 'overdue')[] }) {
  const [rows, setRows] = useState(initial)
  const [toast, setToast] = useState<string | null>(null)
  const [state, setState] = useState<ViewState>({ viewDefinition: { dataViewLayout: 'list' }, filterGroup: emptyFilterGroup(), sorts: [], groupBy: null })
  const patchRow = (path: string, r: Row) => setRows((rs) => rs.map((x) => (x.summary.path === path ? r : x)))
  return (
    <>
      <DataView
        rows={rows}
        types={[TASK_TYPE]}
        scope={{ typeIds: ['task'] }}
        state={state}
        onState={setState}
        layouts={['list']}
        patchRow={patchRow}
        rowExtras={(r) =>
          taskRowExtras(r, TASK_TYPE, {
            badges,
            today: TODAY,
            onResult: (o) => {
              if (o.row) patchRow(o.row.summary.path, o.row)
              setToast(completionToast(o))
            },
          })
        }
      />
      {toast && <div role="status">{toast}</div>}
    </>
  )
}

beforeEach(() => {
  resetLinkIndex()
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockReset()
})

describe('taskRowExtras', () => {
  test('shows checkbox, repeat and reminder icons, deadline label, priority and badges', () => {
    const r = taskRow('Tasks/A.md', {
      status: ['Not Started'],
      priority: ['High'],
      date: { start: '2026-10-30', resolution: 'day' },
      deadline: { start: '2026-10-28', resolution: 'day' },
      repeat: 'every week',
      remind: '1 day before at 09:00',
    })
    render(<Owner initial={[r]} badges={['deadline', 'occurrence']} />)
    const li = screen.getByRole('listitem')
    expect(within(li).getByRole('checkbox')).toBeInTheDocument()
    expect(within(li).getByTestId('task-date')).toHaveTextContent('Oct 30, 2026')
    expect(within(li).getByTestId('task-repeat')).toHaveAttribute('title', 'Weekly on Friday')
    expect(within(li).getByTestId('task-reminder')).toBeInTheDocument()
    expect(within(li).getByText('2 days left')).toBeInTheDocument()
    expect(within(li).getByText('Scheduled after deadline')).toBeInTheDocument()
    expect(within(li).getByText('High')).toBeInTheDocument()
    expect(within(li).getByTestId('badge-deadline')).toHaveTextContent('Deadline')
    expect(within(li).getByTestId('badge-occurrence')).toBeInTheDocument()
    // The checkbox is not inside the row's open button.
    expect(within(li).getByRole('checkbox').closest('button[type="button"]:not([role])')).toBeNull()
  })

  test('an invalid repeat or a reminder that does not fit shows no icon', () => {
    const r = taskRow('Tasks/A.md', { date: { start: '2026-10-30', resolution: 'day' }, repeat: 'weekly', remind: '15 minutes before' })
    render(<Owner initial={[r]} />)
    expect(screen.queryByTestId('task-repeat')).toBeNull()
    expect(screen.queryByTestId('task-reminder')).toBeNull()
  })

  test('test 409 reloads without retry', async () => {
    const user = userEvent.setup()
    mocked.updateProperties.mockRejectedValue(new ConflictError('v9'))
    mocked.rows.mockResolvedValue([taskRow('Tasks/A.md', { status: ['In Progress'] }, 'v9')])
    render(<Owner initial={[taskRow('Tasks/A.md', { status: ['Not Started'] }, 'v1')]} />)
    await user.click(screen.getByRole('checkbox'))
    expect(await screen.findByRole('status')).toHaveTextContent('Changed elsewhere. Reloaded.')
    expect(mocked.updateProperties).toHaveBeenCalledTimes(1)
    expect(mocked.rows).toHaveBeenCalledTimes(1)
    expect(mocked.rows).toHaveBeenCalledWith({ paths: ['Tasks/A.md'] })
  })

  test('the owner patches its list with the reloaded row', async () => {
    const user = userEvent.setup()
    const res: UpdateResult = { version: 'v2', frontmatter: {}, links: {}, synced: [], skipped: [], task: { completed: true, advanced: false } }
    mocked.updateProperties.mockResolvedValue(res)
    mocked.rows.mockResolvedValue([taskRow('Tasks/A.md', { status: ['Done'] }, 'v2')])
    render(<Owner initial={[taskRow('Tasks/A.md', { status: ['Not Started'] }, 'v1')]} />)
    await user.click(screen.getByRole('checkbox'))
    await waitFor(() => expect(screen.getByRole('checkbox')).toHaveAttribute('aria-checked', 'true'))
    expect(screen.queryByRole('status')).toBeNull()
  })
})
