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
    // M32: Enter set the date, so the picker closes (the chip passes the picker its `onClose`).
    await waitFor(() => expect(screen.queryByTestId('date-picker')).toBeNull())
  })

  // The walk's W7: "Pick a date" opened with the focus on the page, so typing "friday" did nothing.
  test('test Pick a date opens with the caret in the date field, its text selected: typing a date and Enter sets it', async () => {
    const user = userEvent.setup()
    mocked.rows.mockResolvedValue([])
    render(<TaskDateChip row={taskRow('Tasks/A.md', { date: day('2026-10-23') }, 'v1')} type={TASK_TYPE} today={TODAY} />)
    await user.click(screen.getByTestId('task-date'))
    await user.click(await screen.findByRole('menuitem', { name: 'Pick a date' }))
    const picker = await screen.findByTestId('date-picker')
    const field = within(picker).getByRole<HTMLInputElement>('textbox', { name: 'Starts' })
    await waitFor(() => expect(field).toHaveFocus())
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, field.value.length])
    // No click in the field: the words replace the date shown.
    await user.keyboard('friday{Enter}')
    await waitFor(() => expect(mocked.updateProperties).toHaveBeenCalledWith('Tasks/A.md', { date: day('2026-10-30') }, 'v1'))
    await waitFor(() => expect(screen.queryByTestId('date-picker')).toBeNull())
  })

  // The M32 review, F8: the picker says it is a menu, so it answers a menu's keys.
  test('test the arrow keys move through the date menu, Home and End jump, and Enter picks', async () => {
    const user = userEvent.setup()
    mocked.rows.mockResolvedValue([])
    render(<TaskDateChip row={taskRow('Tasks/A.md', { date: day('2026-10-23') }, 'v1')} type={TASK_TYPE} today={TODAY} />)
    await user.click(screen.getByTestId('task-date'))
    const menu = await screen.findByRole('menu', { name: 'Date' })
    const item = (name: string) => within(menu).getByRole('menuitem', { name })
    await waitFor(() => expect(item('Today')).toHaveFocus())
    await user.keyboard('{ArrowDown}')
    expect(item('Tomorrow')).toHaveFocus()
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}')
    expect(item('Pick a date')).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(item('Today')).toHaveFocus() // round to the top
    await user.keyboard('{ArrowUp}')
    expect(item('Pick a date')).toHaveFocus()
    await user.keyboard('{Home}')
    expect(item('Today')).toHaveFocus()
    await user.keyboard('{End}{ArrowUp}{ArrowUp}')
    expect(item('Next week')).toHaveFocus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(mocked.updateProperties).toHaveBeenCalledWith('Tasks/A.md', { date: day('2026-11-02') }, 'v1'))
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

// M33 (choice 6): where a task is listed by its deadline, the chip is the deadline's.
describe('TaskDateChip for the deadline (M33)', () => {
  test('test the deadline chip says it is a deadline and shows it; a passed one is in the danger colour', () => {
    const missed = taskRow('Tasks/A.md', { status: ['Next Up'], deadline: day('2026-10-23') })
    const { rerender } = render(<TaskDateChip property="deadline" row={missed} type={TASK_TYPE} today={TODAY} />)
    const chip = screen.getByRole('button', { name: 'Deadline: Oct 23, 2026' })
    expect(chip).toHaveTextContent('Oct 23, 2026')
    expect(chip).toHaveAttribute('title', 'Deadline: Oct 23, 2026')
    expect(chip).toHaveAttribute('data-chip', 'deadline')
    expect(chip).toHaveAttribute('data-testid', 'task-date')
    expect(chip.className).toContain('var(--danger)')
    expect(chip).toHaveAttribute('data-overdue')
    // Done, due today or still to come: not in the danger colour.
    for (const row of [
      taskRow('Tasks/A.md', { status: ['Done'], deadline: day('2026-10-23') }),
      taskRow('Tasks/A.md', { status: ['Next Up'], deadline: day('2026-10-26') }),
      taskRow('Tasks/A.md', { status: ['Next Up'], deadline: day('2026-10-29') }),
    ]) {
      rerender(<TaskDateChip property="deadline" row={row} type={TASK_TYPE} today={TODAY} />)
      expect(screen.getByTestId('task-date').className).not.toContain('var(--danger)')
      expect(screen.getByTestId('task-date')).not.toHaveAttribute('data-overdue')
    }
    // The date chip is as it was: no title, no mark.
    rerender(<TaskDateChip row={taskRow('Tasks/A.md', { status: ['Next Up'], date: day('2026-10-23') })} type={TASK_TYPE} today={TODAY} />)
    expect(screen.getByRole('button', { name: 'Date: Oct 23, 2026' })).not.toHaveAttribute('data-chip')
    expect(screen.getByRole('button', { name: 'Date: Oct 23, 2026' })).not.toHaveAttribute('title')
  })

  test('test the deadline chip edits the deadline, not the date', async () => {
    const user = userEvent.setup()
    const onResult = vi.fn()
    const fresh = taskRow('Tasks/A.md', { status: ['Next Up'], deadline: day('2026-10-27') }, 'v2')
    mocked.rows.mockResolvedValue([fresh])
    render(
      <TaskDateChip property="deadline" row={taskRow('Tasks/A.md', { status: ['Next Up'], deadline: day('2026-10-23') }, 'v1')} type={TASK_TYPE} today={TODAY} onResult={onResult} />,
    )
    await user.click(screen.getByRole('button', { name: 'Deadline: Oct 23, 2026' }))
    const menu = await screen.findByRole('menu', { name: 'Deadline' })
    expect(within(menu).getAllByRole('menuitem').map((b) => b.textContent)).toEqual(['Today', 'Tomorrow', 'Next week', 'No deadline', 'Pick a date'])
    await user.click(within(menu).getByRole('menuitem', { name: 'Tomorrow' }))
    await waitFor(() => expect(mocked.updateProperties).toHaveBeenCalledWith('Tasks/A.md', { deadline: day('2026-10-27') }, 'v1'))
    expect(mocked.updateProperties).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ row: fresh, conflict: false })))
    await waitFor(() => expect(screen.queryByRole('menu', { name: 'Deadline' })).toBeNull())
  })

  test('test "No deadline" clears the deadline and "Pick a date" sets it from the picker', async () => {
    const user = userEvent.setup()
    mocked.rows.mockResolvedValue([])
    render(<TaskDateChip property="deadline" row={taskRow('Tasks/A.md', { deadline: day('2026-10-23') }, 'v1')} type={TASK_TYPE} today={TODAY} />)
    await user.click(screen.getByTestId('task-date'))
    await user.click(await screen.findByRole('menuitem', { name: 'No deadline' }))
    await waitFor(() => expect(mocked.updateProperties).toHaveBeenLastCalledWith('Tasks/A.md', { deadline: null }, 'v1'))
    await waitFor(() => expect(screen.queryByRole('menu', { name: 'Deadline' })).toBeNull())

    await user.click(screen.getByTestId('task-date'))
    await user.click(await screen.findByRole('menuitem', { name: 'Pick a date' }))
    const picker = await screen.findByTestId('date-picker')
    const field = within(picker).getByRole('textbox', { name: 'Starts' })
    await user.clear(field)
    await user.type(field, '2026-11-20{Enter}')
    await waitFor(() => expect(mocked.updateProperties).toHaveBeenLastCalledWith('Tasks/A.md', { deadline: day('2026-11-20') }, 'v1'))
    await waitFor(() => expect(screen.queryByTestId('date-picker')).toBeNull())
  })

  test('test a read-only task shows its deadline as text, still named a deadline', () => {
    const locked = taskRow('Tasks/B.md', { deadline: day('2026-10-23') }, 'v1')
    render(<TaskDateChip property="deadline" row={{ ...locked, summary: { ...locked.summary, readOnly: true } }} type={TASK_TYPE} today={TODAY} />)
    expect(screen.getByTestId('task-date')).toHaveTextContent('Oct 23, 2026')
    expect(screen.getByTestId('task-date')).toHaveAttribute('title', 'Deadline: Oct 23, 2026')
    expect(screen.queryByRole('button')).toBeNull()
  })
})
