import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { ensureLinkIndex } from '@/links/linkIndex'
import { currentTarget, usePeek, useTabs } from '@/nav/tabs'
import { settingsDefaults, useSettings } from '@/settings/useSettings'
import { useUiStore } from '@/shell/usePinned'
import { calendarDay, objectSummary } from '@/test/mockApi'
import { mocked, resetDayMocks, TODAY } from './dayFixtures'
import { QuickCreateChips } from './QuickCreateChips'

beforeEach(async () => {
  resetDayMocks()
  await ensureLinkIndex()
})

const chipNames = () =>
  Array.from(screen.getByTestId('quick-create').querySelectorAll('button[data-type-id]')).map((b) => b.getAttribute('data-type-id'))

describe('QuickCreateChips', () => {
  test('test quick-create chip creates object with first date property set to the day', async () => {
    const user = userEvent.setup()
    const onCreated = vi.fn()
    render(<QuickCreateChips day="2026-10-24" calendarDay={calendarDay()} summaries={{}} onCreated={onCreated} />)
    expect(chipNames()).toEqual(['task', 'meeting', 'journal'])
    const meeting = screen.getByRole('button', { name: /Meeting/ })
    expect(meeting).toHaveAttribute('title', 'Create Meeting linked to this day.')
    await user.click(meeting)
    expect(mocked.createObject).toHaveBeenCalledWith('meeting', { values: { when: { start: '2026-10-24', resolution: 'day' } } })
    await waitFor(() => expect(onCreated).toHaveBeenCalled())
    expect(currentTarget(useTabs.getState())).toEqual({ kind: 'object', path: 'meeting/Untitled.md' })

    // A Task is made with its `date` set. M32: "Open objects as a full page" starts on, so it
    // opens as a page; with the setting off it opens in the peek.
    await user.click(screen.getByRole('button', { name: /Task/ }))
    expect(mocked.createObject).toHaveBeenLastCalledWith('task', { values: { date: { start: '2026-10-24', resolution: 'day' } } })
    await waitFor(() => expect(currentTarget(useTabs.getState())).toEqual({ kind: 'object', path: 'task/Untitled.md' }))
    expect(usePeek.getState().path).toBeNull()

    useSettings.setState({ settings: { ...settingsDefaults, alwaysOpenAsFullPage: false } })
    try {
      await user.click(screen.getByRole('button', { name: /Task/ }))
      await waitFor(() => expect(usePeek.getState().path).toBe('task/Untitled.md'))
    } finally {
      useSettings.setState({ settings: settingsDefaults })
    }
  })

  test('test createOnce chip hides after creation', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<QuickCreateChips day={TODAY} calendarDay={calendarDay()} summaries={{}} />)
    await user.click(screen.getByRole('button', { name: /Journal/ }))
    await waitFor(() => expect(chipNames()).toEqual(['task', 'meeting']))
    // Another day still offers it; a day whose dated entries hold a Journal does not.
    rerender(<QuickCreateChips day="2026-10-25" calendarDay={calendarDay()} summaries={{}} />)
    expect(chipNames()).toContain('journal')
    rerender(
      <QuickCreateChips
        day="2026-10-26"
        calendarDay={calendarDay({ dated: [{ path: 'Journals/J.md', key: 'day', start: '2026-10-26', resolution: 'day' }] })}
        summaries={{ 'Journals/J.md': objectSummary({ path: 'Journals/J.md', type: 'journal' }) }}
      />,
    )
    expect(chipNames()).toEqual(['task', 'meeting'])
  })

  test('test disabled type has no chip', () => {
    render(<QuickCreateChips day={TODAY} calendarDay={calendarDay()} summaries={{}} />)
    expect(chipNames()).not.toContain('secret')
    expect(chipNames()).not.toContain('page') // no date property
    expect(chipNames()).not.toContain('dailynote') // the daily note has its own slot
  })

  test('test chips row toggle writes hideCreateObjects and uses the two tooltips', async () => {
    const user = userEvent.setup()
    render(<QuickCreateChips day={TODAY} calendarDay={calendarDay()} summaries={{}} />)
    expect(screen.getByRole('group').getAttribute('title')).toBe(
      "Makes an object dated this day. To take a type off this list, change that type's settings.",
    )
    const hide = screen.getByRole('button', { name: 'Hide the quick-create buttons.' })
    expect(hide).toHaveAttribute('title', 'Hide the quick-create buttons.')
    await user.click(hide)
    await waitFor(() =>
      expect(mocked.patchUi).toHaveBeenCalledWith(
        { calendar: { weekStart: 'sunday', daily: { hideCreateObjects: true } } },
        { baseRevision: 'r0' },
      ),
    )
    expect(chipNames()).toEqual([])
    const show = screen.getByRole('button', { name: 'Show buttons that create objects on this day.' })
    expect(show).toHaveAttribute('title', 'Show buttons that create objects on this day.')
    expect(useUiStore.getState().ui.calendar?.daily.hideCreateObjects).toBe(true)
    await user.click(show)
    expect(chipNames()).toEqual(['task', 'meeting', 'journal'])
  })
})
