// M23 Task 9: the focus rail: chips in order, the current one marked, a cleared one struck through
// with "1/3 cleared"; clicking selects the line and shows Now with only its work; Edit and Save focus.
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api, ConflictError } from '@/api/client'
import type { FocusDay, WorkBoard } from '@/api/types'
import { focusDay } from '@/test/mockApi'
import boardJson from '../__fixtures__/board.json'
import { resetWorkData, useWorkData } from '../state/useWorkData'
import { focusLineToday, loadWorkUi, useWorkUi } from '../state/useWorkUi'
import { nowPoolOf, resetWorkViews } from '../views/registry'
import { WorkPage } from './WorkPage'
import { clearWorkSearch } from './WorkTopBar'

const mocked = vi.mocked(api)
const board = boardJson as unknown as WorkBoard
const NOW = new Date('2026-11-05T10:00:00.000Z')

/** Three lines: Printer (Now's top item), Last week fix (done) and Order toner (not Gene's turn). */
function threeLines(): FocusDay {
  const day = focusDay(['Fix [[Printer jams on line 3|the printer]]', 'Wrap up [[Last week fix]]', 'Order [[Order toner]]'])
  const paths = ['Tasks/Printer jams on line 3.md', 'Tasks/Last week fix.md', 'Tasks/Order toner.md']
  day.lines.forEach((l, i) => (l.links[0].path = paths[i]))
  return day
}

const rail = () => screen.getByRole('group', { name: 'Focus lines' })
const chip = (n: number) => rail().querySelector(`[data-focus-line="${n}"]`) as HTMLElement
const selectedView = () =>
  screen.getByRole('navigation', { name: 'Work views' }).querySelector('[aria-current="page"]')?.getAttribute('data-work-view')
const nowCount = () =>
  screen.getByRole('navigation', { name: 'Work views' }).querySelector('[data-work-view="now"] [data-count]')?.textContent ?? null

async function show() {
  render(<WorkPage />)
  await act(async () => {})
}

describe('FocusRail', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    vi.clearAllMocks()
    window.localStorage.clear()
    loadWorkUi(null)
    resetWorkData()
    resetWorkViews()
    clearWorkSearch()
    mocked.workBoard.mockResolvedValue(board)
    mocked.workFocus.mockResolvedValue(threeLines())
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  test('test chips in order, the current one marked and a cleared one struck through', async () => {
    await show()
    const chips = within(rail()).getAllByRole('button').filter((b) => b.hasAttribute('data-focus-line'))
    expect(chips.map((c) => c.textContent)).toEqual(['1. Fix the printer', '2. Wrap up Last week fix', '3. Order Order toner'])
    // Printer is Now's top item, so line 1 is the current one (the you tone).
    expect(nowPoolOf(useWorkData.getState(), NOW)[0].title).toBe('Printer jams on line 3')
    expect(chip(1)).toHaveAttribute('data-current')
    expect(chip(1)).toHaveAttribute('data-tone', 'you')
    expect(chip(3)).not.toHaveAttribute('data-current')
    // Last week fix is done: struck through and muted.
    expect(chip(2)).toHaveAttribute('data-cleared')
    expect(chip(2).className).toContain('line-through')
    expect(chip(2).className).toContain('text-fg-muted')
    expect(within(rail()).getByText('1/3 cleared')).toBeInTheDocument()
  })

  test('test clicking selects the line and Now shows only its work', async () => {
    const user = userEvent.setup()
    await show()
    // Flow is folded under More views (Gene's redesign: the Drive views on one row).
    await user.click(screen.getByRole('button', { name: 'More views' }))
    await user.click(screen.getByRole('button', { name: /^Flow/ }))
    expect(selectedView()).toBe('flow')
    expect(nowCount()).toBe('7')

    // Line 3 links only Order toner, which isn't Gene's turn: Now has nothing, never other work.
    await user.click(chip(3))
    expect(focusLineToday(useWorkUi.getState())).toBe(3)
    expect(chip(3)).toHaveAttribute('aria-pressed', 'true')
    expect(selectedView()).toBe('now')
    expect(nowCount()).toBeNull()
    expect(nowPoolOf(useWorkData.getState(), NOW)).toEqual([])

    // Line 1: only Printer.
    await user.click(chip(1))
    expect(nowPoolOf(useWorkData.getState(), NOW).map((i) => i.title)).toEqual(['Printer jams on line 3'])
    expect(nowCount()).toBe('1')

    // Line 2's work is all done: nothing of it is waiting.
    await user.click(chip(2))
    expect(nowCount()).toBeNull()

    // Clicking the selected one again clears it.
    await user.click(chip(2))
    expect(useWorkUi.getState().focusLine).toBeNull()
    expect(nowCount()).toBe('7')
  })

  test('test no lines hides the rail; Now\u2019s Focus card keeps Edit', async () => {
    mocked.workFocus.mockResolvedValue(focusDay([]))
    await show()
    // Gene's redesign: an empty rail is clutter; Now's side still offers Edit to add lines.
    expect(screen.queryByRole('group', { name: 'Focus lines' })).toBeNull()
    expect(within(screen.getByRole('region', { name: 'Focus' })).getByRole('button', { name: 'Edit' })).toBeInTheDocument()
  })

  test('test edit then save sends the lines with the version', async () => {
    const user = userEvent.setup()
    await show()
    await user.click(within(rail()).getByRole('button', { name: 'Edit' }))
    const area = screen.getByRole('textbox', { name: 'Focus lines' })
    expect(area).toHaveValue('Fix [[Printer jams on line 3|the printer]]\nWrap up [[Last week fix]]\nOrder [[Order toner]]')
    await user.clear(area)
    await user.type(area, 'Fix [[[[Printer jams on line 3]]{Enter}{Enter}  Call Pat  ')
    await user.click(screen.getByRole('button', { name: 'Save focus' }))
    await act(async () => {})
    expect(mocked.saveWorkFocus).toHaveBeenCalledWith('2026-11-05', ['Fix [[Printer jams on line 3]]', 'Call Pat'], 'v1')
    // Saved: the rail shows the new lines.
    expect(chip(2).textContent).toBe('2. Call Pat')
  })

  test('test cancel keeps the lines', async () => {
    const user = userEvent.setup()
    await show()
    await user.click(within(rail()).getByRole('button', { name: 'Edit' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(mocked.saveWorkFocus).not.toHaveBeenCalled()
    expect(chip(1).textContent).toBe('1. Fix the printer')
  })

  test("test a stale note shows Today's note changed. Look again.", async () => {
    const user = userEvent.setup()
    await show()
    mocked.saveWorkFocus.mockRejectedValueOnce(new ConflictError('v9'))
    const loads = mocked.workFocus.mock.calls.length
    await user.click(within(rail()).getByRole('button', { name: 'Edit' }))
    await user.click(screen.getByRole('button', { name: 'Save focus' }))
    await act(async () => {})
    expect(screen.getByText("Today's note changed. Look again.")).toBeInTheDocument()
    expect(mocked.workFocus.mock.calls.length).toBe(loads + 1)
    // The editor stays open with what was typed.
    expect(screen.getByRole('textbox', { name: 'Focus lines' })).toBeInTheDocument()
  })
})
