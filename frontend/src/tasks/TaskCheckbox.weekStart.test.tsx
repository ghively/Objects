// With `ui.calendar.weekStart` unset the recurring-task dialog and the calendar must agree on the
// default (Sunday, Capacities' default): the missed-days grid starts its weeks where the calendar does.
import { act, render, renderHook, screen } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))
vi.mock('@/tasks/RecurringOverdueDialog', () => ({
  RecurringOverdueDialog: (p: Record<string, unknown>) => <div data-testid="overdue-dialog" data-weekstart={String(p.weekStart)} />,
}))

import { api } from '@/api/client'
import { useWeekStart } from '@/calendar/useCalendar'
import { resetPinned, useUiStore } from '@/shell/usePinned'
import { TaskCheckbox } from './TaskCheckbox'
import { TASK_TYPE, taskRow } from './taskFixtures'

const mocked = vi.mocked(api)
const UI = { pinned: [], sections: [], allNotesLayout: 'list' as const }

beforeEach(() => {
  resetPinned()
  useUiStore.setState({ ui: UI, revision: 'r1', loaded: true })
  mocked.ui.mockResolvedValue({ ui: UI, revision: 'r1' })
})

describe('week start default', () => {
  test('the overdue dialog is told the same week start as the calendar when ui.calendar is unset', async () => {
    const { result } = renderHook(() => useWeekStart())
    expect(result.current).toBe('sunday')
    const taskApi = {
      updateProperties: mocked.updateProperties,
      rows: mocked.rows,
      overdue: vi.fn(async () => ({ count: 3, capped: false, missed: ['2026-10-28', '2026-10-29', '2026-10-30'], current: '2026-10-31', today: '2026-11-01' })),
      occurrence: vi.fn(),
    }
    const r = taskRow('Tasks/T.md', { status: ['Not Started'], date: { start: '2020-01-01', resolution: 'day' }, repeat: 'every day' })
    render(<TaskCheckbox row={r} type={TASK_TYPE} taskApi={taskApi as never} />)
    await act(async () => {
      screen.getByRole('checkbox').click()
      await new Promise((res) => setTimeout(res, 20))
    })
    const dlg = await screen.findByTestId('overdue-dialog')
    expect(dlg.getAttribute('data-weekstart')).toBe(result.current)
  })
})
