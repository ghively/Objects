import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { useTabs } from '@/nav/tabs'
import { taskRow } from '@/tasks/taskFixtures'
import { taskEntry } from '@/test/mockApi'
import { listeners, mocked, pageRow, resetDayMocks, setDay, setRows, TODAY } from './dayFixtures'
import { ThreeDaysView } from './ThreeDaysView'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 23, 10, 0))
  resetDayMocks()
})

const columns = () => screen.getAllByTestId('three-days-column')

describe('ThreeDaysView', () => {
  test('test three days renders anchor and neighbours with headers and no tabs or chips', async () => {
    setDay(TODAY, { tasks: [taskEntry({ path: 'Tasks/A.md', day: TODAY })], created: ['Pages/New.md'] })
    setRows([taskRow('Tasks/A.md', { date: { start: TODAY, resolution: 'day' } }), pageRow('Pages/New.md')])
    render(<ThreeDaysView anchor={TODAY} weekStart="sunday" />)
    expect(columns().map((c) => c.getAttribute('data-day'))).toEqual(['2026-10-22', TODAY, '2026-10-24'])
    expect(mocked.calendar).toHaveBeenCalledWith('2026-10-22', '2026-10-24')
    expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual([
      'October 22, 2026',
      'October 23, 2026',
      'October 24, 2026',
    ])
    // Small headers; the Today pill only on today's column.
    expect(screen.getAllByRole('heading', { level: 1 })[0].className).toContain('text-[18px]')
    expect(screen.getAllByTestId('today-pill')).toHaveLength(1)
    expect(within(columns()[1]).getByTestId('today-pill')).toBeInTheDocument()
    expect(within(columns()[0]).getAllByText('Week 43')).toHaveLength(1)
    // Each column is the header over its daily note slot and nothing else
    // No Tasks / Created / Backlinks sections here: they are the Day view's.
    await waitFor(() => expect(screen.getAllByTestId('daily-note-slot')).toHaveLength(3))
    expect(screen.queryByTestId('day-sections')).toBeNull()
    expect(screen.queryByTestId('section-tasks')).toBeNull()
    expect(screen.queryByText('Created Today')).toBeNull()
    expect(screen.queryByText('No tasks on this day')).toBeNull()
    expect(screen.queryByRole('tablist', { name: 'Day sections' })).toBeNull()
    expect(screen.queryByTestId('quick-create')).toBeNull()
    // One range for the three days, and no rows call: no section needs one.
    expect(mocked.calendar).toHaveBeenCalledTimes(1)
    expect(mocked.rows).not.toHaveBeenCalled()
    expect(screen.getByTestId('three-days-view').className).toContain('divide-x')
  })

  test('test three days columns have daily note slot per day and create works per day', async () => {
    const user = userEvent.setup()
    setDay('2026-10-22', { dailyNote: { path: 'DailyNotes/2026-10-22.md', reviewed: false } })
    setRows([pageRow('DailyNotes/2026-10-22.md', 'dailynote')])
    const { container } = render(<ThreeDaysView anchor={TODAY} weekStart="sunday" />)
    await waitFor(() => expect(screen.getAllByTestId('daily-note-slot')).toHaveLength(3))
    expect(within(columns()[0]).queryByRole('button', { name: 'Daily Note' })).toBeNull()
    expect(container.querySelector('[data-object-path="DailyNotes/2026-10-22.md"]')).not.toBeNull()
    expect(within(columns()[1]).getByRole('button', { name: 'Daily Note' })).toBeInTheDocument()
    await user.click(within(columns()[2]).getByRole('button', { name: 'Daily Note' }))
    expect(mocked.createDailyNote).toHaveBeenCalledWith('2026-10-24')
    await waitFor(() => expect(container.querySelector('[data-object-path="DailyNotes/2026-10-24.md"]')).not.toBeNull())
    expect(within(columns()[1]).getByRole('button', { name: 'Daily Note' })).toBeInTheDocument()
  })

  test('test multi-day date row holds Reviewed, expand and the note menu for an existing note', async () => {
    const user = userEvent.setup()
    useTabs.setState({ open: vi.fn() } as never)
    setDay('2026-10-22', { dailyNote: { path: 'DailyNotes/2026-10-22.md', reviewed: false } })
    render(<ThreeDaysView anchor={TODAY} weekStart="sunday" />)
    const col = columns()[0]
    const pill = await within(col).findByTestId('day-note-pill')
    // On the date row (in the header), in order: Reviewed, expand, `…`.
    expect(within(col).getByTestId('day-header').contains(pill)).toBe(true)
    await waitFor(() => expect(within(pill).getByRole('button', { name: 'More' })).toBeInTheDocument())
    const controls = Array.from(pill.querySelectorAll('button'))
    expect(controls.map((c) => c.getAttribute('aria-label'))).toEqual(['Reviewed', 'Open as Page', 'More'])
    // Days without a note have none.
    expect(within(columns()[1]).queryByTestId('day-note-pill')).toBeNull()
    expect(within(columns()[2]).queryByTestId('day-note-pill')).toBeNull()
    // Reviewed writes with the note's loaded version.
    const reviewed = within(pill).getByRole('checkbox', { name: 'Reviewed' })
    await waitFor(() => expect(reviewed).toBeEnabled())
    await user.click(reviewed)
    expect(mocked.updateProperties).toHaveBeenCalledWith('DailyNotes/2026-10-22.md', { reviewed: true }, 'v1')
    // Expand opens the note as a page.
    await user.click(within(pill).getByRole('button', { name: 'Open as Page' }))
    expect(useTabs.getState().open).toHaveBeenCalledWith({ kind: 'object', path: 'DailyNotes/2026-10-22.md' }, { via: 'link' })
  })

  test('test views reload when a daily note is created elsewhere', async () => {
    const { container } = render(<ThreeDaysView anchor={TODAY} weekStart="sunday" />)
    await waitFor(() => expect(within(columns()[1]).getByRole('button', { name: 'Daily Note' })).toBeInTheDocument())
    setDay(TODAY, { dailyNote: { path: 'DailyNotes/2026-10-23.md', reviewed: false } })
    act(() => listeners.forEach((l) => l({ kind: 'created', path: 'DailyNotes/2026-10-23.md', version: 'v1' })))
    await waitFor(() => expect(container.querySelector('[data-object-path="DailyNotes/2026-10-23.md"]')).not.toBeNull())
    expect(mocked.calendar).toHaveBeenCalledTimes(2)
  })
})
