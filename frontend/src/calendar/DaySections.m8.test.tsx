// M8 Task 14: the Day view's Backlinks, Date references and Timeline sections.
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import type { CalendarDay, Row } from '@/api/types'
import { usePeek } from '@/nav/tabs'
import { objectSummary, row } from '@/test/mockApi'
import { mocked, pageRow, resetDayMocks, setDay, setRows, TODAY } from './dayFixtures'
import { dayExtras, rangePaths, type CalendarDayM8 } from './DaySections'
import { DayView } from './DayView'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 23, 10, 0))
  resetDayMocks()
})

/** `setDay` with M8's optional fields (the fixtures' `CalendarDay` predates them). */
const setDayM8 = (day: string, cd: Partial<CalendarDayM8>) => setDay(day, cd as Partial<CalendarDay>)

const meetingRow = (path: string, values: Record<string, unknown> = {}): Row =>
  row({ summary: objectSummary({ path, type: 'meeting' }), values })

const at = (h: number, m = 0) => new Date(2026, 9, 23, h, m).toISOString()

describe('Day view: Backlinks, Date references, Timeline', () => {
  test('test day view shows backlinks, date references and timeline', async () => {
    setDayM8(TODAY, {
      backlinks: ['Pages/Linker.md'],
      references: [
        { path: 'Pages/Mentions.md', count: 3 },
        { path: 'Pages/Once.md', count: 1 },
      ],
      timeline: [
        { path: 'Meetings/Standup.md', at: at(14, 30), kind: 'dated', key: 'when' },
        { path: 'Pages/Fresh.md', at: at(8, 5), kind: 'created' },
      ],
    })
    setRows([
      pageRow('Pages/Linker.md'),
      pageRow('Pages/Mentions.md'),
      pageRow('Pages/Once.md'),
      pageRow('Pages/Fresh.md'),
      meetingRow('Meetings/Standup.md'),
    ])
    render(<DayView day={TODAY} />)

    const backlinks = await screen.findByTestId('section-backlinks')
    expect(within(backlinks).getByRole('heading', { name: 'Backlinks' })).toBeInTheDocument()
    expect(await within(backlinks).findByText('Linker')).toBeInTheDocument()

    const refs = screen.getByTestId('section-references')
    expect(within(refs).getByRole('heading', { name: 'Date references' })).toBeInTheDocument()
    expect(await within(refs).findByText('Mentions')).toBeInTheDocument()
    expect(within(refs).getByText('Once')).toBeInTheDocument()
    // The count shows when an object references the day more than once.
    expect(within(refs).getAllByTestId('reference-count').map((c) => c.textContent)).toEqual(['3'])

    const timeline = screen.getByTestId('section-timeline')
    expect(within(timeline).getByRole('heading', { name: 'Timeline' })).toBeInTheDocument()
    const items = await within(timeline).findAllByRole('listitem')
    // Sorted by time: the creation at 8:05 first, then the meeting's "When" value at 2:30 PM.
    expect(items.map((li) => li.getAttribute('data-kind'))).toEqual(['created', 'dated'])
    expect(items[0]).toHaveTextContent('8:05 AM')
    expect(items[0]).toHaveTextContent('Created')
    expect(items[0]).toHaveTextContent('Fresh')
    expect(items[1]).toHaveTextContent('2:30 PM')
    expect(items[1]).toHaveTextContent('when')
    expect(items[1]).toHaveTextContent('Standup')

    // An item opens its object in the peek.
    const peek = vi.spyOn(usePeek.getState(), 'peek')
    await userEvent.click(within(items[1]).getByRole('button'))
    expect(peek).toHaveBeenCalledWith('Meetings/Standup.md', ['Pages/Fresh.md', 'Meetings/Standup.md'])

    // The sections' objects are loaded by the range's one rows call.
    const paths = mocked.rows.mock.calls.flatMap((c) => c[0]?.paths ?? [])
    for (const p of ['Pages/Linker.md', 'Pages/Mentions.md', 'Meetings/Standup.md', 'Pages/Fresh.md']) expect(paths).toContain(p)
  })

  test('test empty states use reference strings', async () => {
    setDayM8(TODAY, { backlinks: [], references: [], timeline: [] })
    render(<DayView day={TODAY} />)
    expect(await within(await screen.findByTestId('section-backlinks')).findByText('No backlinks')).toBeInTheDocument()
    expect(await within(screen.getByTestId('section-references')).findByText('No references')).toBeInTheDocument()
    expect(within(screen.getByTestId('section-timeline')).getByText('No date references.')).toBeInTheDocument()
  })

  test('test missing fields read as empty', async () => {
    // A server before Task 15: the day has none of the three fields.
    setDay(TODAY, {})
    const cd = { dailyNote: null, tasks: [], dated: [], created: ['Pages/A.md'], updated: [] } satisfies CalendarDay
    expect(dayExtras(cd)).toEqual({ backlinks: [], references: [], timeline: [] })
    expect(dayExtras(null)).toEqual({ backlinks: [], references: [], timeline: [] })
    expect(rangePaths({ from: TODAY, to: TODAY, today: TODAY, days: { [TODAY]: cd }, summaries: {}, warnings: [] })).toEqual(['Pages/A.md'])
    render(<DayView day={TODAY} />)
    expect(await within(await screen.findByTestId('section-backlinks')).findByText('No backlinks')).toBeInTheDocument()
    expect(await within(screen.getByTestId('section-references')).findByText('No references')).toBeInTheDocument()
    expect(within(screen.getByTestId('section-timeline')).getByText('No date references.')).toBeInTheDocument()
  })

  test('test the sections show under all only and collapse', async () => {
    setDayM8(TODAY, { backlinks: ['Pages/Linker.md'] })
    setRows([pageRow('Pages/Linker.md')])
    render(<DayView day={TODAY} />)
    const backlinks = await screen.findByTestId('section-backlinks')
    await within(backlinks).findByText('Linker')
    await userEvent.click(within(backlinks).getByRole('button', { name: 'Backlinks' }))
    await waitFor(() => expect(within(screen.getByTestId('section-backlinks')).queryByText('Linker')).toBeNull())
    // Another filter tab hides the three sections.
    await userEvent.click(screen.getByRole('tab', { name: 'Tasks' }))
    await waitFor(() => expect(screen.queryByTestId('section-backlinks')).toBeNull())
    expect(screen.queryByTestId('section-references')).toBeNull()
    expect(screen.queryByTestId('section-timeline')).toBeNull()
  })
})
