import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { ConflictError } from '@/api/client'
import type { Row, ViewState } from '@/api/types'
import { useSettings } from '@/settings/useSettings'
import { useUiStore } from '@/shell/usePinned'
import { taskRow } from '@/tasks/taskFixtures'
import { taskEntry } from '@/test/mockApi'
import { emptyFilterGroup } from '@/views/model'
import { mocked, pageRow, resetDayMocks, setDay, setRows, TODAY } from './dayFixtures'
import { moveDate, overduePipeline, taskBadges } from './DaySections'
import { DayView } from './DayView'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 23, 10, 0))
  resetDayMocks()
})

const tasksSection = () => screen.getByTestId('section-tasks')
const rowOf = (title: string) => within(tasksSection()).getByText(title).closest('li') as HTMLElement

const day = (start: string) => ({ start, resolution: 'day' as const })

describe('DaySections', () => {
  test('test tasks section stats today, past and future', async () => {
    const tasks = (d: string) => [
      taskEntry({ path: 'Tasks/A.md', day: d }),
      taskEntry({ path: 'Tasks/B.md', day: d, done: true }),
      taskEntry({ path: 'Tasks/C.md', day: d, done: true }),
    ]
    setDay(TODAY, { tasks: tasks(TODAY) })
    setDay('2026-10-20', { tasks: tasks('2026-10-20') })
    setDay('2026-10-30', { tasks: tasks('2026-10-30') })
    setRows([taskRow('Tasks/A.md'), taskRow('Tasks/B.md', { status: ['Done'] }), taskRow('Tasks/C.md', { status: ['Done'] })])
    const { rerender } = render(<DayView day={TODAY} />)
    expect(await screen.findByTestId('task-stats')).toHaveTextContent('1 open, 2 done')
    rerender(<DayView day="2026-10-20" />)
    await waitFor(() => expect(screen.getByTestId('task-stats')).toHaveTextContent('2 done'))
    rerender(<DayView day="2026-10-30" />)
    await waitFor(() => expect(screen.getByTestId('task-stats')).toHaveTextContent('1 open'))
    // No tasks: no stats, the day's empty state.
    setDay('2026-10-31', {})
    rerender(<DayView day="2026-10-31" />)
    expect(await screen.findByText('No tasks on this day')).toBeInTheDocument()
    expect(screen.queryByTestId('task-stats')).toBeNull()
  })

  test('test overdue group on today only with count', async () => {
    setDay(TODAY, {
      tasks: [
        taskEntry({ path: 'Tasks/Late.md', kind: 'overdue', day: '2026-10-20' }),
        taskEntry({ path: 'Tasks/Later.md', kind: 'overdue', day: '2026-10-21' }),
        taskEntry({ path: 'Tasks/Now.md', day: TODAY }),
      ],
    })
    setDay('2026-10-24', { tasks: [taskEntry({ path: 'Tasks/Now.md', day: '2026-10-24' })] })
    setRows([taskRow('Tasks/Late.md'), taskRow('Tasks/Later.md'), taskRow('Tasks/Now.md')])
    const { rerender } = render(<DayView day={TODAY} />)
    await within(await screen.findByTestId('section-tasks')).findByText('Late')
    const headers = within(tasksSection()).getAllByTestId('group-header').map((h) => h.textContent)
    expect(headers[0]).toContain('Overdue (2)')
    expect(headers[1]).toContain('Today')
    rerender(<DayView day="2026-10-24" />)
    await waitFor(() => expect(within(tasksSection()).queryByText('Late')).toBeNull())
    expect(within(tasksSection()).queryAllByTestId('group-header')).toHaveLength(0)
  })

  test('test overdue group built from entry badges via the pipeline prop', () => {
    const badges = taskBadges({
      dailyNote: null,
      dated: [],
      created: [],
      updated: [],
      tasks: [taskEntry({ path: 'Tasks/Late.md', kind: 'overdue' }), taskEntry({ path: 'Tasks/Now.md' })],
    })
    const state: ViewState = { viewDefinition: { dataViewLayout: 'list' }, filterGroup: emptyFilterGroup(), sorts: [], groupBy: null }
    const rows: Row[] = [taskRow('Tasks/Now.md'), taskRow('Tasks/Late.md')]
    const ctx = { types: [], collections: [], tagIdsToTitles: {}, pathsById: {}, entityTitles: {}, entityCreated: {}, now: new Date() }
    const res = overduePipeline(badges)(rows, state, ctx)
    expect(res.groups.map((g) => [g.id, g.label, g.rows.map((r) => r.summary.path)])).toEqual([
      ['overdue', 'Overdue (1)', ['Tasks/Late.md']],
      ['today', 'Today', ['Tasks/Now.md']],
    ])
    expect(res.rows.map((r) => r.summary.path)).toEqual(['Tasks/Late.md', 'Tasks/Now.md'])
    // No overdue rows: the view's own grouping (one "Objects" group, no headers).
    const plain = overduePipeline(new Map())(rows, state, ctx)
    expect(plain.groups).toHaveLength(1)
    expect(plain.groups[0].id).toBe('other')
  })

  test('test deadline and occurrence entries are marked', async () => {
    setDay(TODAY, {
      tasks: [
        taskEntry({ path: 'Tasks/Due.md', kind: 'deadline', day: TODAY }),
        taskEntry({ path: 'Tasks/Again.md', kind: 'occurrence', day: TODAY }),
        taskEntry({ path: 'Tasks/Plain.md', kind: 'date', day: TODAY }),
      ],
    })
    setRows([taskRow('Tasks/Due.md'), taskRow('Tasks/Again.md'), taskRow('Tasks/Plain.md')])
    render(<DayView day={TODAY} />)
    await within(await screen.findByTestId('section-tasks')).findByText('Due')
    expect(within(rowOf('Due')).getByTestId('badge-deadline')).toHaveTextContent('Deadline')
    expect(within(rowOf('Again')).getByTestId('badge-occurrence')).toBeInTheDocument()
    expect(within(rowOf('Plain')).queryByTestId('badge-deadline')).toBeNull()
    expect(within(rowOf('Plain')).queryByTestId('badge-occurrence')).toBeNull()
  })

  test('test path with two entry kinds renders once with both badges', async () => {
    setDay(TODAY, {
      tasks: [taskEntry({ path: 'Tasks/Both.md', kind: 'date', day: TODAY }), taskEntry({ path: 'Tasks/Both.md', kind: 'deadline', day: TODAY })],
    })
    setRows([taskRow('Tasks/Both.md', { date: day(TODAY), deadline: day(TODAY) })])
    render(<DayView day={TODAY} />)
    await within(await screen.findByTestId('section-tasks')).findByText('Both')
    expect(within(tasksSection()).getAllByText('Both')).toHaveLength(1)
    expect(within(rowOf('Both')).getByTestId('badge-deadline')).toBeInTheDocument()
    expect(screen.getByTestId('task-stats')).toHaveTextContent('1 open, 0 done')
  })

  test('test task checkbox completes through updateProperties', async () => {
    const user = userEvent.setup()
    setDay(TODAY, { tasks: [taskEntry({ path: 'Tasks/A.md', day: TODAY })] })
    setRows([taskRow('Tasks/A.md', { status: ['Not Started'] }, 'v3')])
    render(<DayView day={TODAY} />)
    await within(await screen.findByTestId('section-tasks')).findByText('A')
    await waitFor(() => expect(mocked.rows).toHaveBeenCalledTimes(1))
    mocked.rows.mockClear()
    mocked.rows.mockResolvedValueOnce([taskRow('Tasks/A.md', { status: ['Done'] }, 'v4')])
    await user.click(within(rowOf('A')).getByRole('checkbox', { name: 'Open' }))
    await waitFor(() => expect(within(rowOf('A')).getByRole('checkbox', { name: 'Done' })).toBeInTheDocument())
    expect(mocked.updateProperties).toHaveBeenCalledTimes(1)
    expect(mocked.updateProperties).toHaveBeenCalledWith('Tasks/A.md', { status: ['Done'] }, 'v3')
    expect(mocked.rows).toHaveBeenCalledTimes(1)
    expect(mocked.rows).toHaveBeenCalledWith({ paths: ['Tasks/A.md'] })
  })

  test('test move all open tasks to tomorrow writes each date and reports a conflict', async () => {
    const user = userEvent.setup()
    setDay(TODAY, {
      tasks: [
        taskEntry({ path: 'Tasks/A.md', day: TODAY }),
        taskEntry({ path: 'Tasks/B.md', kind: 'overdue', day: '2026-10-20' }),
        taskEntry({ path: 'Tasks/C.md', day: TODAY }),
        taskEntry({ path: 'Tasks/Done.md', day: TODAY, done: true }),
        taskEntry({ path: 'Tasks/Occ.md', kind: 'occurrence', day: TODAY }),
      ],
    })
    setRows([
      taskRow('Tasks/A.md', { date: day(TODAY), repeat: 'every day' }, 'va'),
      taskRow('Tasks/B.md', { date: day('2026-10-20') }, 'vb'),
      taskRow('Tasks/C.md', { date: day(TODAY) }, 'vc'),
      taskRow('Tasks/Done.md', { date: day(TODAY), status: ['Done'] }, 'vd'),
      taskRow('Tasks/Occ.md', { date: day('2026-10-22') }, 'vo'),
    ])
    mocked.updateProperties.mockImplementation(async (path, updates, base) => {
      if (path === 'Tasks/B.md') throw new ConflictError('vb2')
      return { version: `${base}+1`, frontmatter: { ...updates }, links: {}, synced: [], skipped: [] }
    })
    render(<DayView day={TODAY} />)
    await within(await screen.findByTestId('section-tasks')).findByText('A')
    const calls = mocked.calendar.mock.calls.length
    await user.click(screen.getByRole('button', { name: 'Add to tasks' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Move all open tasks to' }))
    // (A pointer path from the sub trigger closes the submenu in jsdom; click the item directly.)
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Tomorrow' }))
    await waitFor(() => expect(mocked.updateProperties).toHaveBeenCalledTimes(3))
    expect(mocked.updateProperties).toHaveBeenCalledWith('Tasks/A.md', { date: day('2026-10-24') }, 'va')
    expect(mocked.updateProperties).toHaveBeenCalledWith('Tasks/B.md', { date: day('2026-10-24') }, 'vb')
    expect(mocked.updateProperties).toHaveBeenCalledWith('Tasks/C.md', { date: day('2026-10-24') }, 'vc')
    expect(await within(tasksSection()).findByRole('status')).toHaveTextContent('1 task changed elsewhere and was not moved.')
    await waitFor(() => expect(mocked.calendar.mock.calls.length).toBeGreaterThan(calls))
  })

  test('test create task from the tasks menu sets the day', async () => {
    const user = userEvent.setup()
    render(<DayView day="2026-10-25" />)
    await screen.findByText('No tasks on this day')
    await user.click(screen.getByRole('button', { name: 'Add to tasks' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Create task' }))
    expect(mocked.createObject).toHaveBeenCalledWith('task', { values: { date: day('2026-10-25') } })
  })

  test('test created and updated sections use saved layout and persist changes to ui.calendar.daily', async () => {
    const user = userEvent.setup()
    const grid: ViewState = { viewDefinition: { dataViewLayout: 'grid' }, filterGroup: emptyFilterGroup(), sorts: [], groupBy: null }
    useUiStore.setState({ ui: { pinned: [], sections: [], allNotesLayout: 'list', calendar: { weekStart: 'sunday', daily: { updatedView: grid } } } })
    setDay(TODAY, { created: ['Pages/New.md'], updated: ['Pages/Old.md'] })
    setRows([pageRow('Pages/New.md'), pageRow('Pages/Old.md')])
    render(<DayView day={TODAY} />)
    const created = await screen.findByTestId('section-created')
    await within(created).findByText('New')
    // Created defaults to the wall; Updated uses its saved grid.
    expect(within(created).getByTestId('wall-layout')).toBeInTheDocument()
    expect(within(screen.getByTestId('section-updated')).getByTestId('grid-layout')).toBeInTheDocument()
    const layoutOf = (el: HTMLElement) => within(el).getByRole('button', { name: 'Layout' })

    // Collapsing a section writes its hide flag.
    await user.click(within(created).getByRole('button', { name: 'Created Today' }))
    await waitFor(() =>
      expect(mocked.patchUi).toHaveBeenCalledWith(
        { calendar: { weekStart: 'sunday', daily: { updatedView: grid, hideCreatedOnDay: true } } },
        { baseRevision: 'r0' },
      ),
    )
    expect(within(screen.getByTestId('section-created')).queryByText('New')).toBeNull()
    for (const [label, key] of [
      ['Tasks', 'hideTasks'],
      ['Updated Today', 'hideUpdated'],
      ['Daily note', 'hideDailyNote'],
    ] as const) {
      await user.click(screen.getByRole('button', { name: label }))
      await waitFor(() => expect(useUiStore.getState().ui.calendar?.daily[key]).toBe(true))
    }

    // Changing a section's layout saves its view.
    mocked.patchUi.mockClear()
    await user.click(within(screen.getByTestId('section-created')).getByRole('button', { name: 'Created Today' }))
    const createdAgain = screen.getByTestId('section-created')
    await within(createdAgain).findByText('New')
    await user.click(layoutOf(createdAgain))
    await user.click(await screen.findByRole('menuitemcheckbox', { name: 'List' }))
    await act(async () => {
      await new Promise((r) => setTimeout(r, 500))
    })
    await waitFor(() => expect(useUiStore.getState().ui.calendar?.daily.createdView?.viewDefinition.dataViewLayout).toBe('list'))
    const last = mocked.patchUi.mock.calls.at(-1)?.[0] as { calendar: { daily: Record<string, unknown> } }
    expect((last.calendar.daily.createdView as ViewState).viewDefinition.dataViewLayout).toBe('list')
  })

  test('moveDate keeps resolution, time of day and range length', () => {
    expect(moveDate({ start: '2026-10-20', resolution: 'day' }, '2026-10-24')).toEqual({ start: '2026-10-24', resolution: 'day' })
    expect(moveDate({ start: '2026-10-20', end: '2026-10-22', resolution: 'day' }, '2026-10-24')).toEqual({
      start: '2026-10-24',
      end: '2026-10-26',
      resolution: 'day',
    })
    expect(moveDate(null, '2026-10-24')).toEqual({ start: '2026-10-24', resolution: 'day' })
    const at9 = new Date(2026, 9, 20, 9, 0).toISOString()
    const moved = moveDate({ start: at9, resolution: 'time' }, '2026-10-24')
    expect(moved.resolution).toBe('time')
    const d = new Date(moved.start)
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2026, 9, 24, 9, 0])
  })

  test('moveDate moves a timed item by days in the Time zone setting, keeping its wall time there', () => {
    const settings = useSettings.getState().settings
    useSettings.setState({ settings: { ...settings, timeZone: 'Pacific/Auckland' } })
    try {
      // 2026-10-28T22:00Z is 29 Oct 11:00 in Auckland; dropped on the 30th it stays at 11:00 there.
      const moved = moveDate({ start: '2026-10-28T22:00:00.000Z', resolution: 'time' }, '2026-10-30')
      expect(moved).toEqual({ start: '2026-10-29T22:00:00.000Z', resolution: 'time' })
    } finally {
      useSettings.setState({ settings })
    }
  })
})
