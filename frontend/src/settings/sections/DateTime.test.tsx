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
import { DateTimeSection, deviceTimeZone, timeZoneList } from './DateTime'

const mocked = vi.mocked(api)

beforeEach(() => {
  vi.clearAllMocks()
  resetPinned()
  useSettings.setState({ settings: settingsDefaults, revision: 'r0', loaded: true })
})

describe('DateTimeSection', () => {
  test('test date formatting shows a live preview of now', async () => {
    const user = userEvent.setup()
    useSettings.setState({ settings: { ...settingsDefaults, twentyFourHourTime: true } })
    render(<DateTimeSection />)
    const preview = screen.getByRole('status', { name: 'Preview' })
    await user.click(within(screen.getByRole('radiogroup', { name: 'Date formatting' })).getByRole('radio', { name: 'year-month-day (ISO 8601)' }))
    expect(preview.textContent).toMatch(/^\d{4}-\d{2}-\d{2}, \d{2}:\d{2}$/)
    await user.click(within(screen.getByRole('radiogroup', { name: 'Date formatting' })).getByRole('radio', { name: 'day-month-year' }))
    expect(preview.textContent).toMatch(/^\d{2}-\d{2}-\d{4}, \d{2}:\d{2}$/)
  })

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

  test('test time zone picker saves and shows mismatch', async () => {
    const user = userEvent.setup()
    const device = deviceTimeZone()
    const other = device === 'Asia/Tokyo' ? 'Europe/Berlin' : 'Asia/Tokyo'
    expect(timeZoneList()).toContain(device)
    expect(timeZoneList()).toContain(other)
    const { rerender } = render(<DateTimeSection />)
    expect(screen.getByRole('heading', { name: 'Time zone' })).toBeInTheDocument()
    expect(screen.getByText('Select your preferred time zone.')).toBeInTheDocument()
    // No setting: the device's zone, no mismatch.
    const button = screen.getByRole('button', { name: 'Time zone' })
    expect(button).toHaveTextContent(device)
    expect(screen.queryByText('Your time zone in Object does not match the time zone of your device.')).toBeNull()

    await user.click(button)
    await user.type(screen.getByRole('searchbox', { name: 'Search time zones' }), other.split('/')[1])
    const list = screen.getByRole('listbox', { name: 'Time zone' })
    await user.click(within(list).getByRole('option', { name: other }))
    expect(mocked.patchSettings).toHaveBeenLastCalledWith({ timeZone: other }, expect.anything())
    rerender(<DateTimeSection />)
    expect(screen.getByRole('button', { name: 'Time zone' })).toHaveTextContent(other)
    expect(screen.getByText('Your time zone in Object does not match the time zone of your device.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Set to local time zone' })).toBeInTheDocument()
  })

  test('test reset sets the device zone', async () => {
    const user = userEvent.setup()
    const device = deviceTimeZone()
    const other = device === 'Asia/Tokyo' ? 'Europe/Berlin' : 'Asia/Tokyo'
    useSettings.setState({ settings: { ...settingsDefaults, timeZone: other }, revision: 'r0', loaded: true })
    render(<DateTimeSection />)
    await user.click(screen.getByRole('button', { name: 'Set to local time zone' }))
    expect(mocked.patchSettings).toHaveBeenLastCalledWith({ timeZone: null }, expect.anything())
    await waitFor(() => expect(screen.getByRole('button', { name: 'Time zone' })).toHaveTextContent(device))
    expect(screen.queryByText('Your time zone in Object does not match the time zone of your device.')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Set to local time zone' })).toBeNull()
  })
})
