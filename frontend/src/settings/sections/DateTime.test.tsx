import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { resetPinned, useUiStore } from '@/shell/usePinned'
import { settingsDefaults, useSettings } from '@/settings/useSettings'
import { DateTimeSection } from './DateTime'

const mocked = vi.mocked(api)

beforeEach(() => {
  vi.clearAllMocks()
  resetPinned()
  useSettings.setState({ settings: settingsDefaults, revision: 'r0', loaded: true })
})

describe('DateTimeSection', () => {
  test('test start of the week patches ui.json calendar keys together', async () => {
    const user = userEvent.setup()
    mocked.ui.mockResolvedValue({
      ui: {
        pinned: [],
        sections: [],
        allNotesLayout: 'list',
        calendar: { weekStart: 'sunday', hideCalendarSidebar: true, daily: { hideTasks: true } },
      },
      revision: 'u1',
    })
    render(<DateTimeSection />)
    expect(screen.getByRole('heading', { level: 2, name: 'Date & Time' })).toBeInTheDocument()
    await waitFor(() => expect(useUiStore.getState().loaded).toBe(true))
    const week = screen.getByRole('radiogroup', { name: 'Start of the week' })
    expect(within(week).getByRole('radio', { name: 'Sunday' })).toHaveAttribute('aria-checked', 'true')
    await user.click(within(week).getByRole('radio', { name: 'Monday' }))
    await waitFor(() =>
      expect(mocked.patchUi).toHaveBeenCalledWith(
        { calendar: { weekStart: 'monday', hideCalendarSidebar: true, daily: { hideTasks: true } } },
        { baseRevision: 'u1' },
      ),
    )
    expect(within(week).getByRole('radio', { name: 'Monday' })).toHaveAttribute('aria-checked', 'true')
  })

  test('test 24-hour time and date formatting patch device settings', async () => {
    const user = userEvent.setup()
    render(<DateTimeSection />)
    await user.click(screen.getByRole('switch', { name: '24-hour time' }))
    expect(mocked.patchSettings).toHaveBeenLastCalledWith({ twentyFourHourTime: true }, expect.anything())
    const fmt = screen.getByRole('radiogroup', { name: 'Date formatting' })
    expect(within(fmt).getAllByRole('radio').map((r) => r.getAttribute('aria-label'))).toEqual([
      'Localized',
      'day-month-year',
      'month/day/year',
      'year-month-day (ISO 8601)',
    ])
    await user.click(within(fmt).getByRole('radio', { name: 'year-month-day (ISO 8601)' }))
    expect(mocked.patchSettings).toHaveBeenLastCalledWith({ dateFormatting: 'YMD' }, expect.anything())
  })
})
