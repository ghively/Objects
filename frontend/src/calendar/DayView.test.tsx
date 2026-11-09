import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { taskRow } from '@/tasks/taskFixtures'
import { currentTarget, useTabs } from '@/nav/tabs'
import { taskEntry } from '@/test/mockApi'
import { mocked, pageRow, resetDayMocks, setDay, setRows, TODAY } from './dayFixtures'
import { DayView } from './DayView'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 23, 10, 0))
  resetDayMocks()
})

const tabLabels = () => screen.getAllByRole('tab').map((t) => t.textContent)
const sectionOrder = () =>
  Array.from(screen.getByTestId('day-sections').children).map((el) => el.getAttribute('data-testid'))

function fullDay(day: string) {
  setDay(day, {
    dailyNote: { path: `DailyNotes/${day}.md`, reviewed: false },
    tasks: [taskEntry({ path: 'Tasks/A.md', day })],
    dated: [{ path: 'Meetings/M.md', key: 'when', start: day, resolution: 'day' }],
    created: ['Pages/New.md'],
    updated: ['Pages/Old.md'],
  })
  setRows([
    pageRow(`DailyNotes/${day}.md`, 'dailynote'),
    taskRow('Tasks/A.md', { date: { start: day, resolution: 'day' } }),
    pageRow('Meetings/M.md', 'meeting'),
    pageRow('Pages/New.md'),
    pageRow('Pages/Old.md'),
  ])
}

describe('DayView', () => {
  test('test section order and tabs', async () => {
    const user = userEvent.setup()
    fullDay(TODAY)
    const { rerender } = render(<DayView day={TODAY} />)
    await screen.findByText('Objects with this date')
    expect(tabLabels()).toEqual(['All', 'Daily note', 'Tasks', 'Dates', 'Created Today', 'Updated Today'])
    expect(screen.getByRole('tab', { name: 'All' })).toHaveAttribute('aria-selected', 'true')
    // M8: Backlinks, Date references and Timeline follow M4's sections (under All only).
    expect(sectionOrder()).toEqual([
      'daily-note-slot',
      'section-tasks',
      'section-dated',
      'section-created',
      'section-updated',
      'section-backlinks',
      'section-references',
      'section-timeline',
    ])
    // A tab shows its section alone.
    await user.click(screen.getByRole('tab', { name: 'Tasks' }))
    expect(sectionOrder()).toEqual(['section-tasks'])
    await user.click(screen.getByRole('tab', { name: 'Created Today' }))
    expect(sectionOrder()).toEqual(['section-created'])
    await user.click(screen.getByRole('tab', { name: 'Daily note' }))
    expect(sectionOrder()).toEqual(['daily-note-slot'])

    // Yesterday, with nothing dated or updated: no Dates or Updated tab.
    setDay('2026-10-22', {})
    rerender(<DayView day="2026-10-22" />)
    await waitFor(() => expect(tabLabels()).toEqual(['All', 'Daily note', 'Tasks', 'Created Yesterday']))
    expect(screen.getByRole('tab', { name: 'Daily note' })).toHaveAttribute('aria-selected', 'true')
    // A tab the day doesn't have falls back to All.
    await user.click(screen.getByRole('tab', { name: 'All' }))
    fullDay('2026-10-21')
    rerender(<DayView day="2026-10-21" />)
    await user.click(await screen.findByRole('tab', { name: 'Dates' }))
    rerender(<DayView day="2026-10-22" />)
    await waitFor(() => expect(screen.getByRole('tab', { name: 'All' })).toHaveAttribute('aria-selected', 'true'))
    // Another day.
    fullDay('2026-10-10')
    rerender(<DayView day="2026-10-10" />)
    await waitFor(() =>
      expect(tabLabels()).toEqual(['All', 'Daily note', 'Tasks', 'Dates', 'Created on This Day', 'Updated on This Day']),
    )
  })

  test('test one rows call per day', async () => {
    fullDay(TODAY)
    render(<DayView day={TODAY} />)
    await screen.findByText('Objects with this date')
    await screen.findByText('New')
    expect(mocked.calendar).toHaveBeenCalledTimes(1)
    expect(mocked.calendar).toHaveBeenCalledWith(TODAY, TODAY)
    expect(mocked.rows).toHaveBeenCalledTimes(1)
    expect(mocked.rows).toHaveBeenCalledWith({
      paths: ['DailyNotes/2026-10-23.md', 'Meetings/M.md', 'Pages/New.md', 'Pages/Old.md', 'Tasks/A.md'],
    })
    // The header's Reviewed control uses the note's row version.
    const reviewed = screen.getByRole('checkbox', { name: 'Reviewed' })
    await waitFor(() => expect(reviewed).not.toBeDisabled())
    expect(within(screen.getByTestId('section-tasks')).getByText('A')).toBeInTheDocument()
  })

  test('test day view header, chips and the empty day', async () => {
    render(<DayView day={TODAY} />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('October 23, 2026')
    expect(await screen.findByText('No tasks today')).toBeInTheDocument()
    // No note yet: the note's placeholder rows (Tags, the body placeholder), no create button.
    const slot = screen.getByTestId('daily-note-slot')
    expect(within(slot).getByRole('button', { name: 'Edit Tags' })).toHaveTextContent('Tags')
    expect(within(slot).getByTestId('daily-note-placeholder')).toHaveTextContent('Start your daily note')
    expect(within(slot).queryByRole('button', { name: 'Daily Note' })).toBeNull()
    expect(screen.queryByRole('checkbox', { name: 'Reviewed' })).toBeNull()
    await waitFor(() => expect(screen.getByTestId('quick-create')).toBeInTheDocument())
    // Visiting the calendar creates nothing.
    expect(mocked.createDailyNote).not.toHaveBeenCalled()
    expect(mocked.rows).not.toHaveBeenCalled()
    expect(screen.getByTestId('day-view').className).toContain('max-w-[50rem]')
  })

  test('T1: on today the header links to the Tasks dashboard’s Today; other days have no link', async () => {
    const user = userEvent.setup()
    useTabs.getState().open({ kind: 'calendar' })
    const { rerender } = render(<DayView day={TODAY} />)
    const header = screen.getByTestId('day-header')
    await user.click(within(header).getByRole('button', { name: 'Tasks dashboard' }))
    expect(currentTarget(useTabs.getState())).toEqual({ kind: 'work', view: 'today' })
    rerender(<DayView day="2026-10-24" />)
    expect(within(screen.getByTestId('day-header')).queryByRole('button', { name: 'Tasks dashboard' })).toBeNull()
  })
})
