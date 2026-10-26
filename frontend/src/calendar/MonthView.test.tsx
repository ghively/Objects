import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { usePeek } from '@/nav/tabs'
import { objectSummary, row } from '@/test/mockApi'
import { listeners, mocked, resetDayMocks, setDay, setRows, TODAY } from './dayFixtures'
import { MonthView } from './MonthView'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 23, 10, 0))
  resetDayMocks()
})

const note = (day: string) => row({ summary: objectSummary({ path: `DailyNotes/${day}.md`, type: 'dailynote', title: day }) })

function addNote(day: string) {
  setDay(day, { dailyNote: { path: `DailyNotes/${day}.md`, reviewed: false } })
  setRows([note(day)])
}

const cardTitles = () =>
  Array.from(screen.getByTestId('grid').children).map((c) => c.textContent ?? '')

describe('MonthView', () => {
  test("test month lists the month's daily notes in date order", async () => {
    // Created out of order; a day of another month in the answer is not shown.
    addNote('2026-10-20')
    addNote('2026-10-02')
    addNote('2026-10-31')
    addNote('2026-11-01')
    render(<MonthView anchor={TODAY} weekStart="sunday" />)
    expect(mocked.calendar).toHaveBeenCalledWith('2026-10-01', '2026-10-31')
    await waitFor(() => expect(screen.getByTestId('grid').children).toHaveLength(3))
    const titles = cardTitles()
    expect(titles[0]).toContain('2026-10-02')
    expect(titles[1]).toContain('2026-10-20')
    expect(titles[2]).toContain('2026-10-31')
    expect(screen.getByTestId('grid-layout')).toBeInTheDocument()
    expect(screen.queryByText('No daily notes created for this month.')).toBeNull()
  })

  test('test month empty line when no daily notes in the month', async () => {
    setDay('2026-10-05', { created: ['Pages/New.md'] })
    render(<MonthView anchor={TODAY} weekStart="sunday" />)
    expect(await screen.findByText('No daily notes created for this month.')).toBeInTheDocument()
    expect(screen.queryByTestId('grid-layout')).toBeNull()
    expect(screen.getByTestId('month-view').children).toHaveLength(1)
    expect(mocked.rows).not.toHaveBeenCalled()
  })

  test('test month loads rows for the daily note paths in one call', async () => {
    const user = userEvent.setup()
    addNote('2026-10-09')
    addNote('2026-10-03')
    setDay('2026-10-04', { created: ['Pages/Other.md'] })
    render(<MonthView anchor={TODAY} weekStart="sunday" />)
    await waitFor(() => expect(screen.getByTestId('grid').children).toHaveLength(2))
    expect(mocked.rows).toHaveBeenCalledTimes(1)
    expect(mocked.rows).toHaveBeenCalledWith({ paths: ['DailyNotes/2026-10-03.md', 'DailyNotes/2026-10-09.md'] })
    // A card opens the note in the peek.
    await user.click(screen.getByText('2026-10-03'))
    expect(usePeek.getState().path).toBe('DailyNotes/2026-10-03.md')
  })

  test('test views reload when a daily note is created elsewhere', async () => {
    render(<MonthView anchor={TODAY} weekStart="sunday" />)
    expect(await screen.findByText('No daily notes created for this month.')).toBeInTheDocument()
    addNote('2026-10-12')
    act(() => listeners.forEach((l) => l({ kind: 'created', path: 'DailyNotes/2026-10-12.md', version: 'v1' })))
    await waitFor(() => expect(screen.getByTestId('grid').children).toHaveLength(1))
    expect(screen.queryByText('No daily notes created for this month.')).toBeNull()
    expect(mocked.calendar).toHaveBeenCalledTimes(2)
  })
})
