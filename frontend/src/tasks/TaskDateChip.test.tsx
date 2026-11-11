// M32, item 9: a task row's date chip opens a small picker (Today, Tomorrow, Next week, No date,
// and the date picker); an overdue date is in the theme's danger colour.
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api, ConflictError } from '@/api/client'
import type { UpdateResult } from '@/api/types'
import { dateOnDay, TaskDateChip } from './TaskDateChip'
import { TASK_TYPE, taskRow } from './taskFixtures'

const mocked = vi.mocked(api)
/** Monday 26 October 2026. */
const TODAY = new Date(2026, 9, 26)
const day = (start: string) => ({ start, resolution: 'day' as const })
const ok: UpdateResult = { version: 'v2', frontmatter: {}, links: {}, synced: [], skipped: [], task: null }

beforeEach(() => {
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockReset()
  mocked.updateProperties.mockResolvedValue(ok)
})

describe('TaskDateChip', () => {
  test('test an overdue date uses the danger colour token; a done or coming one does not', () => {
    const { rerender } = render(<TaskDateChip row={taskRow('Tasks/A.md', { status: ['Next Up'], date: day('2026-10-23') })} type={TASK_TYPE} today={TODAY} />)
    const chip = screen.getByTestId('task-date')
    expect(chip).toHaveTextContent('Oct 23, 2026')
    expect(chip.className).toContain('var(--danger)')
    expect(chip).toHaveAttribute('data-overdue')
    rerender(<TaskDateChip row={taskRow('Tasks/A.md', { status: ['Done'], date: day('2026-10-23') })} type={TASK_TYPE} today={TODAY} />)
    expect(screen.getByTestId('task-date').className).not.toContain('var(--danger)')
    rerender(<TaskDateChip row={taskRow('Tasks/A.md', { status: ['Next Up'], date: day('2026-10-26') })} type={TASK_TYPE} today={TODAY} />)
    expect(screen.getByTestId('task-date').className).not.toContain('var(--danger)')
    expect(screen.getByTestId('task-date')).not.toHaveAttribute('data-overdue')
  })

  test('test the date chip opens Today, Tomorrow, Next week, No date and a pick writes the date', async () => {
    const user = userEvent.setup()
    const onResult = vi.fn()
    const fresh = taskRow('Tasks/A.md', { status: ['Next Up'], date: day('2026-10-27') }, 'v2')
    mocked.rows.mockResolvedValue([fresh])
    render(<TaskDateChip row={taskRow('Tasks/A.md', { status: ['Next Up'], date: day('2026-10-23') }, 'v1')} type={TASK_TYPE} today={TODAY} onResult={onResult} />)
    await user.click(screen.getByRole('button', { name: 'Date: Oct 23, 2026' }))
    const menu = await screen.findByRole('menu', { name: 'Date' })
    expect(within(menu).getAllByRole('menuitem').map((b) => b.textContent)).toEqual(['Today', 'Tomorrow', 'Next week', 'No date', 'Pick a date'])
    await user.click(within(menu).getByRole('menuitem', { name: 'Tomorrow' }))
    await waitFor(() => expect(mocked.updateProperties).toHaveBeenCalledWith('Tasks/A.md', { date: day('2026-10-27') }, 'v1'))
    expect(mocked.updateProperties).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ row: fresh, conflict: false })))
    expect(mocked.rows).toHaveBeenCalledWith({ paths: ['Tasks/A.md'] })
    await waitFor(() => expect(screen.queryByRole('menu', { name: 'Date' })).toBeNull())
  })

  test('Today and Next week count from today; No date clears it', async () => {
    const user = userEvent.setup()
    mocked.rows.mockResolvedValue([])
    render(<TaskDateChip row={taskRow('Tasks/A.md', { date: day('2026-10-23') }, 'v1')} type={TASK_TYPE} today={TODAY} />)
    for (const [name, value] of [
      ['Today', day('2026-10-26')],
      ['Next week', day('2026-11-02')],
      ['No date', null],
    ] as const) {
      await user.click(screen.getByTestId('task-date'))
      await user.click(await screen.findByRole('menuitem', { name }))
      await waitFor(() => expect(mocked.updateProperties).toHaveBeenLastCalledWith('Tasks/A.md', { date: value }, 'v1'))
      await waitFor(() => expect(screen.queryByRole('menu', { name: 'Date' })).toBeNull())
    }
  })

  test('test a task with no date has the chip too, to set one', async () => {
    const user = userEvent.setup()
    mocked.rows.mockResolvedValue([])
    render(<TaskDateChip row={taskRow('Tasks/A.md', {}, 'v1')} type={TASK_TYPE} today={TODAY} />)
    await user.click(screen.getByRole('button', { name: 'Date: No date' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Today' }))
    await waitFor(() => expect(mocked.updateProperties).toHaveBeenCalledWith('Tasks/A.md', { date: day('2026-10-26') }, 'v1'))
  })

  test('Pick a date shows the date picker, whose change is written', async () => {
    const user = userEvent.setup()
    mocked.rows.mockResolvedValue([])
    render(<TaskDateChip row={taskRow('Tasks/A.md', { date: day('2026-10-23') }, 'v1')} type={TASK_TYPE} today={TODAY} />)
    await user.click(screen.getByTestId('task-date'))
    await user.click(await screen.findByRole('menuitem', { name: 'Pick a date' }))
    const picker = await screen.findByTestId('date-picker')
    const field = within(picker).getByRole('textbox', { name: 'Starts' })
    await user.clear(field)
    await user.type(field, '2026-11-20{Enter}')
    await waitFor(() => expect(mocked.updateProperties).toHaveBeenCalledWith('Tasks/A.md', { date: day('2026-11-20') }, 'v1'))
  })

  test('a 409 reloads the row and reports the conflict; a read-only task has no picker', async () => {
    const user = userEvent.setup()
    const onResult = vi.fn()
    mocked.updateProperties.mockRejectedValue(new ConflictError('v9'))
    mocked.rows.mockResolvedValue([taskRow('Tasks/A.md', { date: day('2026-10-30') }, 'v9')])
    const { unmount } = render(<TaskDateChip row={taskRow('Tasks/A.md', { date: day('2026-10-23') }, 'v1')} type={TASK_TYPE} today={TODAY} onResult={onResult} />)
    await user.click(screen.getByTestId('task-date'))
    await user.click(await screen.findByRole('menuitem', { name: 'Today' }))
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ conflict: true })))
    expect(mocked.updateProperties).toHaveBeenCalledTimes(1)
    unmount()

    const locked = taskRow('Tasks/B.md', { date: day('2026-10-23') }, 'v1')
    render(<TaskDateChip row={{ ...locked, summary: { ...locked.summary, readOnly: true } }} type={TASK_TYPE} today={TODAY} />)
    expect(screen.getByTestId('task-date')).toHaveTextContent('Oct 23, 2026')
    expect(screen.queryByRole('button')).toBeNull()
  })

  test('dateOnDay keeps a range’s length and a time’s time of day', () => {
    expect(dateOnDay(null, '2026-10-27')).toEqual(day('2026-10-27'))
    expect(dateOnDay({ start: '2026-10-20', end: '2026-10-22', resolution: 'day' }, '2026-10-27')).toEqual({
      start: '2026-10-27',
      end: '2026-10-29',
      resolution: 'day',
    })
    const at = new Date(2026, 9, 20, 14, 30)
    const moved = dateOnDay({ start: at.toISOString(), resolution: 'time' }, '2026-10-27')
    expect(moved.resolution).toBe('time')
    expect(new Date(moved.start).getTime()).toBe(new Date(2026, 9, 27, 14, 30).getTime())
  })
})
