import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api, ConflictError } from '@/api/client'
import type { UiState } from '@/api/types'
import { pinnedActions, resetPinned, useUiStore } from '@/shell/usePinned'
import { saveCalendarDaily, saveCalendarUi } from './calendarUi'

const mocked = vi.mocked(api)

function ui(calendar: UiState['calendar']): UiState {
  return { pinned: [], sections: [], allNotesLayout: 'list', calendar }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('calendarUi', () => {
  test('test saveCalendarUi keeps weekStart, daily and hideCalendarSidebar together', async () => {
    useUiStore.setState({
      ui: ui({ weekStart: 'monday', daily: { hideTasks: true }, hideCalendarSidebar: false }),
      revision: 'r1',
      loaded: true,
    })
    mocked.patchUi.mockResolvedValueOnce({ ui: ui(undefined), revision: 'r2' })
    const p = saveCalendarUi({ hideCalendarSidebar: true })
    // Optimistic.
    expect(useUiStore.getState().ui.calendar).toEqual({ weekStart: 'monday', daily: { hideTasks: true }, hideCalendarSidebar: true })
    await p
    expect(mocked.patchUi).toHaveBeenLastCalledWith(
      { calendar: { weekStart: 'monday', daily: { hideTasks: true }, hideCalendarSidebar: true } },
      { baseRevision: 'r1' },
    )
    expect(useUiStore.getState().revision).toBe('r2')

    // saveCalendarDaily no longer drops hideCalendarSidebar.
    mocked.patchUi.mockResolvedValueOnce({ ui: ui(undefined), revision: 'r3' })
    await saveCalendarDaily({ hideDated: true })
    expect(mocked.patchUi).toHaveBeenLastCalledWith(
      { calendar: { weekStart: 'monday', daily: { hideTasks: true, hideDated: true }, hideCalendarSidebar: true } },
      { baseRevision: 'r2' },
    )

    // Week start through saveCalendarUi keeps the rest.
    mocked.patchUi.mockResolvedValueOnce({ ui: ui(undefined), revision: 'r4' })
    await saveCalendarUi({ weekStart: 'sunday' })
    expect(mocked.patchUi).toHaveBeenLastCalledWith(
      { calendar: { weekStart: 'sunday', daily: { hideTasks: true, hideDated: true }, hideCalendarSidebar: true } },
      { baseRevision: 'r3' },
    )
  })

  test('a 409 re-applies the same change to the fresh calendar once', async () => {
    useUiStore.setState({ ui: ui({ weekStart: 'sunday', daily: {} }), revision: 'r1', loaded: true })
    mocked.patchUi.mockRejectedValueOnce(new ConflictError('r9'))
    mocked.ui.mockResolvedValueOnce({ ui: ui({ weekStart: 'monday', daily: { hideUpdated: true } }), revision: 'r9' })
    mocked.patchUi.mockResolvedValueOnce({ ui: ui(undefined), revision: 'r10' })
    await saveCalendarUi({ hideCalendarSidebar: true })
    expect(mocked.patchUi).toHaveBeenLastCalledWith(
      { calendar: { weekStart: 'monday', daily: { hideUpdated: true }, hideCalendarSidebar: true } },
      { baseRevision: 'r9' },
    )
    expect(useUiStore.getState().ui.calendar).toEqual({ weekStart: 'monday', daily: { hideUpdated: true }, hideCalendarSidebar: true })
    expect(useUiStore.getState().revision).toBe('r10')
  })
})

describe('calendarUi and the other ui.json writers', () => {
  test('a calendar edit waits for a sidebar save in flight and survives its answer', async () => {
    resetPinned()
    useUiStore.setState({ ui: ui({ weekStart: 'sunday', daily: {} }), revision: 'r1', loaded: true })
    let answerPin!: () => void
    mocked.patchUi.mockImplementationOnce(
      (patch) =>
        new Promise((r) => {
          // The server's ui after the pin: the calendar edit is not in it yet.
          answerPin = () => r({ ui: { ...ui({ weekStart: 'sunday', daily: {} }), ...patch } as UiState, revision: 'r2' })
        }),
    )
    mocked.patchUi.mockImplementationOnce(async (patch) => ({ ui: { ...ui({ weekStart: 'sunday', daily: {} }), ...patch } as UiState, revision: 'r3' }))
    const pin = pinnedActions.pin({ kind: 'type', id: 'page' })
    await vi.waitFor(() => expect(mocked.patchUi).toHaveBeenCalledTimes(1))
    const week = saveCalendarUi({ weekStart: 'monday' })
    await Promise.resolve()
    // One queue: the calendar save is not sent alongside the sidebar's with the same revision.
    expect(mocked.patchUi).toHaveBeenCalledTimes(1)
    answerPin()
    await pin
    await week
    expect(mocked.patchUi).toHaveBeenLastCalledWith({ calendar: { weekStart: 'monday', daily: {} } }, { baseRevision: 'r2' })
    expect(useUiStore.getState().ui.calendar?.weekStart).toBe('monday')
    expect(useUiStore.getState().ui.pinned).toEqual([{ kind: 'type', id: 'page' }])
    expect(useUiStore.getState().revision).toBe('r3')
  })
})
