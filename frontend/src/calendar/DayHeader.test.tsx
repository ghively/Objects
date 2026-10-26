import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { ensureLinkIndex, invalidateLinkIndex } from '@/links/linkIndex'
import { typeDef } from '@/test/mockApi'
import { ALL_TYPES, DAILYNOTE, mocked, resetDayMocks, TODAY } from './dayFixtures'
import { DayHeader, ReviewedButton } from './DayHeader'

beforeEach(() => {
  resetDayMocks()
})

describe('DayHeader', () => {
  test('test header shows weekday colour, Today pill only on today, long date and week number', () => {
    const { rerender } = render(<DayHeader day={TODAY} today={TODAY} weekStart="sunday" />)
    const weekday = screen.getByTestId('day-weekday')
    expect(weekday).toHaveTextContent('Friday')
    expect(weekday.className).toContain('text-blue-500')
    expect(screen.getByTestId('today-pill')).toHaveTextContent('Today')
    expect(screen.getByTestId('today-pill').className).toContain('bg-red-50/50')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('October 23, 2026')
    expect(screen.getByTestId('day-week')).toHaveTextContent('Week 43')

    rerender(<DayHeader day="2026-10-25" today={TODAY} weekStart="sunday" />)
    expect(screen.queryByTestId('today-pill')).toBeNull()
    expect(screen.getByTestId('day-weekday')).toHaveTextContent('Sunday')
    expect(screen.getByTestId('day-weekday').className).toContain('text-red-500')
    expect(screen.getByTestId('day-week')).toHaveTextContent('Week 44')
    rerender(<DayHeader day="2026-10-25" today={TODAY} weekStart="monday" />)
    expect(screen.getByTestId('day-week')).toHaveTextContent('Week 43')

    rerender(<DayHeader day={TODAY} today={TODAY} weekStart="sunday" size="sm" />)
    expect(screen.getByRole('heading', { level: 1 }).className).toContain('text-[18px]')
  })

  test('test reviewed button writes reviewed and is hidden without a note or with hideReviewing', async () => {
    const user = userEvent.setup()
    await ensureLinkIndex()
    const onWritten = vi.fn()
    const note = { path: 'DailyNotes/2026-10-23.md', reviewed: false }
    const { rerender } = render(<ReviewedButton note={note} version="v7" onWritten={onWritten} />)
    const box = screen.getByRole('checkbox', { name: 'Reviewed' })
    expect(box).toHaveAttribute('aria-checked', 'false')
    await user.click(box)
    expect(mocked.updateProperties).toHaveBeenCalledWith(note.path, { reviewed: true }, 'v7')
    await waitFor(() => expect(onWritten).toHaveBeenCalled())
    expect(box).toHaveAttribute('aria-checked', 'true')

    rerender(<ReviewedButton note={null} version={undefined} />)
    expect(screen.queryByRole('checkbox', { name: 'Reviewed' })).toBeNull()

    mocked.space.mockResolvedValue({
      name: 's',
      root: '/s',
      types: [...ALL_TYPES.filter((t) => t.id !== 'dailynote'), typeDef({ ...DAILYNOTE, hideReviewing: true })],
    })
    await invalidateLinkIndex()
    rerender(<ReviewedButton note={note} version="v7" />)
    expect(screen.queryByRole('checkbox', { name: 'Reviewed' })).toBeNull()
  })
})
