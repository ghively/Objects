import { act, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { listeners, mocked, pageRow, resetDayMocks, setDay, setRows, TODAY } from './dayFixtures'
import { WeekView } from './WeekView'

const scrolled: string[] = []
const original = Element.prototype.scrollIntoView

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 23, 10, 0))
  resetDayMocks()
  scrolled.length = 0
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this.id)
  }
})
afterEach(() => {
  Element.prototype.scrollIntoView = original
})

const blocks = () => screen.getAllByTestId('week-day')

describe('WeekView', () => {
  test('test week renders seven stacked day blocks starting on the week start, each with a small header and a daily note slot', async () => {
    setDay('2026-10-20', { dailyNote: { path: 'DailyNotes/2026-10-20.md', reviewed: false }, created: ['Pages/New.md'] })
    setRows([pageRow('DailyNotes/2026-10-20.md', 'dailynote'), pageRow('Pages/New.md')])
    const { container, rerender } = render(<WeekView anchor={TODAY} weekStart="sunday" />)
    expect(blocks().map((b) => b.getAttribute('data-day'))).toEqual([
      '2026-10-18',
      '2026-10-19',
      '2026-10-20',
      '2026-10-21',
      '2026-10-22',
      '2026-10-23',
      '2026-10-24',
    ])
    expect(blocks().map((b) => b.id)).toEqual(blocks().map((b) => `week-${b.getAttribute('data-day')}`))
    expect(mocked.calendar).toHaveBeenCalledWith('2026-10-18', '2026-10-24')
    for (const b of blocks()) expect(within(b).getByRole('heading', { level: 1 }).className).toContain('text-[18px]')
    expect(within(blocks()[5]).getByTestId('today-pill')).toBeInTheDocument()
    expect(screen.getAllByTestId('today-pill')).toHaveLength(1)
    await waitFor(() => expect(screen.getAllByTestId('daily-note-slot')).toHaveLength(7))
    expect(container.querySelector('[data-object-path="DailyNotes/2026-10-20.md"]')).not.toBeNull()
    expect(screen.getAllByRole('button', { name: 'Daily Note' })).toHaveLength(6)
    // No sections, no chips, no tabs.
    expect(screen.queryByTestId('day-sections')).toBeNull()
    expect(screen.queryByTestId('quick-create')).toBeNull()
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(mocked.rows).not.toHaveBeenCalled()

    // Monday start.
    rerender(<WeekView anchor="2026-10-25" weekStart="monday" />)
    expect(blocks()[0].getAttribute('data-day')).toBe('2026-10-19')
    expect(blocks()[6].getAttribute('data-day')).toBe('2026-10-25')
  })

  test('test week scrolls the anchor day into view', async () => {
    const { rerender } = render(<WeekView anchor={TODAY} weekStart="sunday" />)
    expect(scrolled).toEqual(['week-2026-10-23'])
    rerender(<WeekView anchor="2026-10-20" weekStart="sunday" />)
    expect(scrolled).toEqual(['week-2026-10-23', 'week-2026-10-20'])
    await waitFor(() => expect(screen.getAllByTestId('daily-note-slot')).toHaveLength(7))
    // A reload does not scroll again.
    expect(scrolled).toHaveLength(2)
  })

  test('test views reload when a daily note is created elsewhere', async () => {
    const { container } = render(<WeekView anchor={TODAY} weekStart="sunday" />)
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Daily Note' })).toHaveLength(7))
    setDay('2026-10-21', { dailyNote: { path: 'DailyNotes/2026-10-21.md', reviewed: false } })
    act(() => listeners.forEach((l) => l({ kind: 'created', path: 'DailyNotes/2026-10-21.md', version: 'v1' })))
    await waitFor(() => expect(container.querySelector('[data-object-path="DailyNotes/2026-10-21.md"]')).not.toBeNull())
    expect(screen.getAllByRole('button', { name: 'Daily Note' })).toHaveLength(6)
  })
})
