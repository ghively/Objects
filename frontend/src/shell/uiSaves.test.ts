// Every `ui.json` writer goes through the one save queue, a save's answer replaces only the keys
// it sent, and a failed save says so and reloads (audit 2026-11-01, shell "other bugs").
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api, ConflictError } from '@/api/client'
import type { UiState } from '@/api/types'
import { saveCalendarUi } from '@/calendar/calendarUi'
import { flushGraphUi, patchGraphUi, resetGraphUi } from '@/graph/useGraphUi'
import { saveRemindersEnabled } from '@/settings/sections/Notifications'
import { saveWorkspaceOrder } from '@/shell/SidebarSections'
import { pinnedActions, resetPinned, useUiStore } from '@/shell/usePinned'

const mocked = vi.mocked(api)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const base = (): UiState => ({ pinned: [], sections: [], allNotesLayout: 'list' })
const PAGE = { kind: 'type', id: 'page' } as const

const toasts = () => [...document.querySelectorAll('[data-editor-toasts] [role="status"]')].map((el) => el.textContent)

beforeEach(() => {
  resetPinned()
  resetGraphUi()
  document.querySelector('[data-editor-toasts]')?.remove()
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockClear()
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

describe('ui.json writers share the save queue', () => {
  test('a graph customization edit survives a pin save that lands before its flush', async () => {
    useUiStore.setState({ ui: base(), revision: 'r1', loaded: true })
    // The server answers the pin with its whole state: no graph key saved yet.
    mocked.patchUi.mockImplementation(async (patch) => ({ ui: { ...base(), ...patch }, revision: 'r2' }))
    patchGraphUi({ showMinimalNodes: true })
    await pinnedActions.pin(PAGE)
    expect(useUiStore.getState().ui.pinned).toEqual([PAGE])
    expect(useUiStore.getState().ui.graph).toEqual({ showMinimalNodes: true })
    await flushGraphUi()
    expect(mocked.patchUi).toHaveBeenLastCalledWith({ graph: { showMinimalNodes: true } }, { baseRevision: 'r2' })
    expect(useUiStore.getState().ui.pinned).toEqual([PAGE])
  })

  test('the Reminders switch waits for the pin save before it and never replaces the local ui', async () => {
    useUiStore.setState({ ui: base(), revision: 'r1', loaded: true })
    let release: () => void = () => undefined
    const pinGate = new Promise<void>((r) => (release = r))
    mocked.patchUi.mockImplementation(async (patch, opts) => {
      if ('pinned' in patch) {
        await pinGate
        return { ui: { ...base(), ...patch }, revision: 'r3' }
      }
      // A stale revision (r1 or r2) is a 409; the pin's answer r3 is current.
      if (opts.baseRevision !== 'r3') throw new ConflictError('r3')
      return { ui: { ...base(), ...patch }, revision: 'r4' }
    })
    mocked.ui.mockResolvedValue({ ui: base(), revision: 'r2' })
    const pin = pinnedActions.pin(PAGE)
    const reminders = saveRemindersEnabled(false)
    await sleep(10)
    // Optimistic at once, in order, and the pin still on screen while both are in flight.
    expect(useUiStore.getState().ui.pinned).toEqual([PAGE])
    expect(useUiStore.getState().ui.reminders).toEqual({ enabled: false })
    expect(mocked.patchUi).toHaveBeenCalledTimes(1)
    release()
    await Promise.all([pin, reminders])
    expect(mocked.patchUi).toHaveBeenCalledTimes(2)
    expect(mocked.patchUi).toHaveBeenLastCalledWith({ reminders: { enabled: false } }, { baseRevision: 'r3' })
    expect(useUiStore.getState().ui.pinned).toEqual([PAGE])
    expect(useUiStore.getState().ui.reminders).toEqual({ enabled: false })
    expect(useUiStore.getState().revision).toBe('r4')
  })

  test("a pin save's answer replaces only the keys it sent", async () => {
    useUiStore.setState({ ui: { ...base(), workspaceOrder: ['objects', 'pinned'], graph: { hideDates: true } }, revision: 'r1', loaded: true })
    mocked.patchUi.mockResolvedValueOnce({ ui: { ...base(), pinned: [PAGE], sections: [{ id: 's1', name: 'From elsewhere', icon: null, items: [] }] }, revision: 'r2' })
    await pinnedActions.pin(PAGE)
    const ui = useUiStore.getState().ui
    expect(ui.pinned).toEqual([PAGE])
    expect(ui.sections).toEqual([])
    expect(ui.workspaceOrder).toEqual(['objects', 'pinned'])
    expect(ui.graph).toEqual({ hideDates: true })
  })
})

describe('a failed ui.json save says so and reloads', () => {
  beforeEach(() => {
    mocked.patchUi.mockRejectedValue(new Error('disk full'))
  })

  test('a pin', async () => {
    useUiStore.setState({ ui: base(), revision: 'r1', loaded: true })
    mocked.ui.mockResolvedValue({ ui: base(), revision: 'r1' })
    await pinnedActions.pin(PAGE)
    expect(useUiStore.getState().ui.pinned).toEqual([])
    expect(toasts()).toEqual(['Could not save the sidebar'])
  })

  test('the sidebar order', async () => {
    useUiStore.setState({ ui: { ...base(), workspaceOrder: ['pinned', 'objects'] }, revision: 'r1', loaded: true })
    mocked.ui.mockResolvedValue({ ui: { ...base(), workspaceOrder: ['pinned', 'objects'] }, revision: 'r1' })
    await saveWorkspaceOrder(['objects', 'pinned'])
    expect(useUiStore.getState().ui.workspaceOrder).toEqual(['pinned', 'objects'])
    expect(toasts()).toEqual(['Could not save the sidebar'])
  })

  test('a calendar setting', async () => {
    useUiStore.setState({ ui: { ...base(), calendar: { weekStart: 'sunday', daily: {} } }, revision: 'r1', loaded: true })
    mocked.ui.mockResolvedValue({ ui: { ...base(), calendar: { weekStart: 'sunday', daily: {} } }, revision: 'r1' })
    await saveCalendarUi({ weekStart: 'monday' })
    expect(useUiStore.getState().ui.calendar?.weekStart).toBe('sunday')
    expect(toasts()).toEqual(['Could not save the calendar settings'])
  })

  test('a graph setting', async () => {
    useUiStore.setState({ ui: { ...base(), graph: { hideDates: true } }, revision: 'r1', loaded: true })
    mocked.ui.mockResolvedValue({ ui: { ...base(), graph: { hideDates: true } }, revision: 'r1' })
    patchGraphUi({ hideDates: false })
    await flushGraphUi()
    expect(useUiStore.getState().ui.graph).toEqual({ hideDates: true })
    expect(toasts()).toEqual(['Could not save the graph settings'])
  })
})
