import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import type { Row, UpdateResult } from '@/api/types'
import type { OverdueInfo } from './taskContract'
import { TaskCheckbox } from './TaskCheckbox'
import type { TaskApi } from './taskActions'
import { TASK_TYPE, taskRow } from './taskFixtures'

const ok = (): UpdateResult => ({ version: 'v2', frontmatter: {}, links: {}, synced: [], skipped: [], task: { completed: false, advanced: true } })

const pad = (n: number) => String(n).padStart(2, '0')
const dayOffset = (n: number) => {
  const d = new Date()
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`
}

function fakeApi(overdue?: Partial<OverdueInfo>): TaskApi & { [k: string]: ReturnType<typeof vi.fn> } {
  return {
    updateProperties: vi.fn().mockResolvedValue(ok()),
    rows: vi.fn().mockImplementation(async ({ paths }: { paths: string[] }) => [taskRow(paths[0], {}, 'v9')]),
    occurrence: vi.fn().mockResolvedValue(ok()),
    overdue: vi.fn().mockResolvedValue({
      count: 1,
      capped: false,
      missed: [dayOffset(-1)],
      current: { start: dayOffset(-1), resolution: 'day' },
      today: dayOffset(0),
      ...overdue,
    }),
  } as never
}

const recurring = (date: string, repeat = 'every day'): Row =>
  taskRow('Tasks/Water plants.md', { status: ['Not Started'], date: { start: date, resolution: 'day' }, repeat }, 'v7')

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Status' }))
  return screen.findByRole('menu', { name: 'Status' })
}

describe('TaskCheckbox (M8 recurrence)', () => {
  test('test skip and excuse call the occurrence route', async () => {
    const user = userEvent.setup()
    const taskApi = fakeApi()
    const onResult = vi.fn()
    const today = dayOffset(0)
    render(<TaskCheckbox row={recurring(today)} type={TASK_TYPE} taskApi={taskApi} onResult={onResult} />)
    let menu = await openMenu(user)
    const skip = within(menu).getByRole('menuitem', { name: 'Skip' })
    expect(skip).toHaveAttribute('title', 'Jump to the next date without completing this one. Breaks your streak and counts as a skip.')
    await user.click(skip)
    await waitFor(() => expect(onResult).toHaveBeenCalledTimes(1))
    expect(taskApi.occurrence).toHaveBeenCalledWith('Tasks/Water plants.md', 'skip', { baseVersion: 'v7' })
    expect(taskApi.rows).toHaveBeenCalledWith({ paths: ['Tasks/Water plants.md'] })
    expect(taskApi.overdue).not.toHaveBeenCalled() // not before today: no overdue check

    menu = await openMenu(user)
    const excuse = within(menu).getByRole('menuitem', { name: 'Excuse' })
    expect(within(menu).queryByRole('menuitem', { name: /Excuse for/ })).toBeNull()
    expect(excuse).toHaveAttribute('title', "Jump to the next date without completing this one. Your streak survives, and excused days are left out of the completion rate.")
    await user.click(excuse)
    await waitFor(() => expect(onResult).toHaveBeenCalledTimes(2))
    expect(taskApi.occurrence).toHaveBeenLastCalledWith('Tasks/Water plants.md', 'excuse', { baseVersion: 'v7' })
    expect(taskApi.updateProperties).not.toHaveBeenCalled()
  })

  test('a task without repeat has no Skip or Excuse', async () => {
    const user = userEvent.setup()
    render(<TaskCheckbox row={taskRow('Tasks/A.md', { status: [] })} type={TASK_TYPE} taskApi={fakeApi()} />)
    const menu = await openMenu(user)
    expect(within(menu).queryByRole('menuitem', { name: 'Skip' })).toBeNull()
  })

  test('test single missed occurrence acts at once', async () => {
    const user = userEvent.setup()
    const taskApi = fakeApi({ count: 1 })
    const onResult = vi.fn()
    render(<TaskCheckbox row={recurring(dayOffset(-1))} type={TASK_TYPE} taskApi={taskApi} onResult={onResult} />)
    await user.click(screen.getByRole('checkbox'))
    await waitFor(() => expect(onResult).toHaveBeenCalledTimes(1))
    expect(taskApi.overdue).toHaveBeenCalledWith('Tasks/Water plants.md')
    // completion stays on M4's status path (the hook logs the line)
    expect(taskApi.updateProperties).toHaveBeenCalledWith('Tasks/Water plants.md', { status: ['Done'] }, 'v7')
    expect(screen.queryByRole('alertdialog')).toBeNull()
    await user.click(within(await openMenu(user)).getByRole('menuitem', { name: 'Skip' }))
    await waitFor(() => expect(taskApi.occurrence).toHaveBeenCalledWith('Tasks/Water plants.md', 'skip', { baseVersion: 'v7' }))
  })

  test('test overdue dialog sends each catch up choice', async () => {
    const choices = [
      ['complete', /This occurrence only/, 'advanceOne'],
      ['complete', /All missed before today/, 'catchUpBeforeNow'],
      ['complete', /Marks every missed date done too/, 'catchUpThroughNow'],
      ['skip', /This occurrence only/, 'advanceOne'],
      ['skip', /All missed before today/, 'catchUpBeforeNow'],
      ['skip', /Also skips all missed/, 'catchUpThroughNow'],
      ['excuse', /This occurrence only/, 'advanceOne'],
      ['excuse', /All missed before today/, 'catchUpBeforeNow'],
    ] as const
    for (const [action, button, catchUp] of choices) {
      const user = userEvent.setup()
      const missed = [dayOffset(-3), dayOffset(-2), dayOffset(-1)]
      const taskApi = fakeApi({ count: 3, missed, current: { start: missed[0], resolution: 'day' } })
      const onResult = vi.fn()
      const { unmount } = render(<TaskCheckbox row={recurring(missed[0])} type={TASK_TYPE} taskApi={taskApi} onResult={onResult} />)
      if (action === 'complete') await user.click(screen.getByRole('checkbox'))
      else {
        const menu = await openMenu(user)
        await user.click(within(menu).getByRole('menuitem', { name: action === 'skip' ? 'Skip' : 'Excuse' }))
      }
      const dialog = await screen.findByRole('alertdialog')
      expect(onResult).not.toHaveBeenCalled()
      if (action === 'excuse') expect(within(dialog).queryByText(/Also/)).toBeNull()
      await user.click(within(dialog).getByRole('button', { name: button }))
      await waitFor(() => expect(onResult).toHaveBeenCalledTimes(1))
      expect(taskApi.occurrence).toHaveBeenCalledWith('Tasks/Water plants.md', action, { catchUp, baseVersion: 'v7' })
      expect(taskApi.updateProperties).not.toHaveBeenCalled()
      expect(screen.queryByRole('alertdialog')).toBeNull()
      unmount()
    }
  })

  test('cancel in the dialog writes nothing', async () => {
    const user = userEvent.setup()
    const taskApi = fakeApi({ count: 2, missed: [dayOffset(-2), dayOffset(-1)] })
    render(<TaskCheckbox row={recurring(dayOffset(-2))} type={TASK_TYPE} taskApi={taskApi} />)
    await user.click(screen.getByRole('checkbox'))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(taskApi.occurrence).not.toHaveBeenCalled()
    expect(taskApi.updateProperties).not.toHaveBeenCalled()
  })
})
