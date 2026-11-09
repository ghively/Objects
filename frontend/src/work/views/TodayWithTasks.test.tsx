// Decision T1 (option B): Tasks › Today keeps the day timeline and lists today's tasks by the
// Calendar Day view's rule (the same list), with "Open in Calendar"; the Today badge counts its open ones.
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

// The timeline has its own tests; here it only has to be there.
vi.mock('./TodayView', async () => {
  const { createElement } = await import('react')
  return { TodayView: () => createElement('div', { 'data-work-view': 'today' }) }
})

import { useCalendar } from '@/calendar/useCalendar'
import { resetDayMocks, setDay, setRows, TODAY } from '@/calendar/dayFixtures'
import { currentTarget, useTabs } from '@/nav/tabs'
import { resetSpaceInfo, useSpaceInfo } from '@/settings/useSpaceInfo'
import { TASK_TYPE, taskRow } from '@/tasks/taskFixtures'
import { resetTaskRows, useTaskRows } from '@/tasks/useTaskRows'
import { taskEntry } from '@/test/mockApi'
import type { WorkDataState } from '../state/useWorkData'
import { WORK_VIEWS } from './registry'
import { TodayWithTasks } from './TodayWithTasks'

const DATA = {} as WorkDataState
const day = (start: string) => ({ start, resolution: 'day' as const })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 23, 10, 0))
  resetDayMocks()
  resetSpaceInfo()
  resetTaskRows()
  useTabs.getState().open({ kind: 'work', view: 'today' })
})
afterEach(() => {
  vi.useRealTimers()
})

function calendarToday() {
  // The server's answer for today: a dated task, a deadline-only one, a done one and an overdue one.
  setDay(TODAY, {
    tasks: [
      taskEntry({ path: 'Tasks/Dated.md', kind: 'date', day: TODAY }),
      taskEntry({ path: 'Tasks/Deadline.md', kind: 'deadline', day: TODAY }),
      taskEntry({ path: 'Tasks/Finished.md', kind: 'date', day: TODAY, done: true }),
      taskEntry({ path: 'Tasks/Late.md', kind: 'overdue', day: '2026-10-20' }),
    ],
  })
  setRows([
    taskRow('Tasks/Dated.md', { status: ['Not Started'], date: day(TODAY) }),
    taskRow('Tasks/Deadline.md', { status: ['Not Started'], deadline: day(TODAY) }),
    taskRow('Tasks/Finished.md', { status: ['Done'], date: day(TODAY) }),
    taskRow('Tasks/Late.md', { status: ['Not Started'], date: day('2026-10-20') }),
  ])
}

describe('TodayWithTasks', () => {
  test('T1: the timeline over the Calendar Day view’s task list for today', async () => {
    calendarToday()
    render(<TodayWithTasks data={DATA} now={new Date()} />)
    const region = await screen.findByRole('region', { name: 'Today’s tasks' })
    expect(document.querySelector('[data-work-view="today"]')).not.toBeNull()
    // The Calendar's Tasks section, not the old task list with its quick add.
    expect(await within(region).findByText('3 open, 1 done')).toBeInTheDocument()
    expect(region.getAttribute('data-testid')).toBe('section-tasks')
    expect(region.querySelector('[data-task-section]')).toBeNull()
    expect(within(region).queryByRole('textbox', { name: 'Task title' })).toBeNull()
    expect(within(region).getByText('Overdue (1)')).toBeInTheDocument()
    expect(within(region).getByRole('button', { name: 'Add to tasks' })).toBeInTheDocument()
    // Deadline-only and done tasks are listed too (the Calendar's rule).
    const paths = [...region.querySelectorAll('[data-path]')].map((el) => el.getAttribute('data-path'))
    expect(new Set(paths)).toEqual(new Set(['Tasks/Dated.md', 'Tasks/Deadline.md', 'Tasks/Finished.md', 'Tasks/Late.md']))
  })

  test('T1: "Open in Calendar" opens the Calendar’s Day view on today', async () => {
    const user = userEvent.setup()
    calendarToday()
    useCalendar.setState({ view: 'month', anchor: '2026-01-01' })
    render(<TodayWithTasks data={DATA} now={new Date()} />)
    await user.click(await screen.findByRole('button', { name: 'Open in Calendar' }))
    expect(currentTarget(useTabs.getState())).toEqual({ kind: 'calendar' })
    expect(useCalendar.getState().view).toBe('day')
    expect(useCalendar.getState().anchor).toBe(TODAY)
  })

  test('T1: while the space hides task management, Today is the timeline alone', async () => {
    calendarToday()
    useSpaceInfo.setState({
      space: { name: 's', root: '/s', types: [], icon: null, description: null, hideTaskManagement: true, revision: 'r' },
      loaded: true,
    })
    render(<TodayWithTasks data={DATA} now={new Date()} />)
    await act(async () => {})
    expect(document.querySelector('[data-work-view="today"]')).not.toBeNull()
    expect(screen.queryByRole('region', { name: 'Today’s tasks' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Open in Calendar' })).toBeNull()
  })

  test('T1: the Today badge counts the open tasks of the same list', () => {
    useTaskRows.setState({
      taskType: TASK_TYPE,
      loading: false,
      rows: [
        taskRow('Tasks/Dated.md', { status: ['Not Started'], date: day(TODAY) }),
        taskRow('Tasks/Deadline.md', { status: ['Not Started'], deadline: day(TODAY) }),
        taskRow('Tasks/Finished.md', { status: ['Done'], date: day(TODAY) }),
        taskRow('Tasks/Late.md', { status: ['Not Started'], date: day('2026-10-20') }),
        taskRow('Tasks/Later.md', { status: ['Not Started'], date: day('2026-10-30') }),
      ],
    })
    const today = WORK_VIEWS.find((v) => v.id === 'today')!
    expect(today.count(DATA, new Date())).toBe(3)
  })
})
