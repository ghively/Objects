// M32, item 10: with Work off for the space nothing of the dashboard runs. Each thing under `work/`
// that mounts globally, listens for keys or fetches is checked here with the switch off (and, where
// it matters, that it comes alive when the switch goes on).
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))
vi.mock('./page/WorkPage', async (orig) => ({
  ...(await orig<typeof import('./page/WorkPage')>()),
  focusBrainDump: vi.fn(),
  focusWorkSearch: vi.fn(),
}))

import { api } from '@/api/client'
import type { ChangeEvent } from '@/api/types'
import { resetSpaceInfo } from '@/settings/useSpaceInfo'
import { resetSettingsModal, useSettingsModal } from '@/settings/useSettingsModal'
import { setWorkOn } from '@/test/workOn'
import { useWorkKeys } from './keys/useWorkKeys'
import { focusBrainDump, focusWorkSearch } from './page/WorkPage'
import { WorkHeader } from './panel/WorkHeader'
import { openWorkPip } from './session/pip'
import { WorkMini } from './session/WorkMini'
import { WorkOverlays } from './session/WorkOverlays'
import { resetWorkData, useWorkData, useWorkEvents, EVENTS_DEBOUNCE_MS } from './state/useWorkData'
import { useWorkOverlay } from './state/useWorkOverlay'
import { loadWorkUi, useWorkUi } from './state/useWorkUi'
import { WorkToasts } from './state/WorkToasts'
import { resetWorkToasts, undoToast, useWorkToasts, workToast } from './state/workToasts'

const mocked = vi.mocked(api)
const WORK_CALLS = [
  'workBoard',
  'workFocus',
  'workToday',
  'workAlerts',
  'workAgent',
  'workCaptures',
  'workWins',
  'generalFloor',
  'workItem',
] as const
const noWorkCall = () => {
  for (const name of WORK_CALLS) expect(mocked[name], name).not.toHaveBeenCalled()
}

type PipWindow = Window & { documentPictureInPicture?: unknown }

function Keys() {
  useWorkKeys()
  return <div data-testid="page" />
}
function Events() {
  useWorkEvents()
  return null
}
const press = (key: string) => fireEvent.keyDown(document.body, { key })

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  resetSpaceInfo()
  resetWorkData()
  resetWorkToasts()
  resetSettingsModal()
  loadWorkUi(null)
  useWorkOverlay.getState().close()
  setWorkOn(false)
})
afterEach(() => {
  vi.useRealTimers()
  delete (window as PipWindow).documentPictureInPicture
})

describe('Work off (M32)', () => {
  test('test no Work key acts while Work is off: not Brain dump, the search, a view key or the Shortcuts sheet', () => {
    render(<Keys />)
    for (const key of ['b', '/', '?', 'j', 'Escape']) press(key)
    press('g')
    press('w')
    expect(focusBrainDump).not.toHaveBeenCalled()
    expect(focusWorkSearch).not.toHaveBeenCalled()
    expect(useWorkUi.getState().view).toBe('now')
    expect(useSettingsModal.getState().shortcutsOpen).toBe(false)
    // On, the same listener acts.
    act(() => setWorkOn(true))
    press('b')
    expect(focusBrainDump).toHaveBeenCalledTimes(1)
    press('g')
    press('w')
    expect(useWorkUi.getState().view).toBe('flow')
  })

  test('test nothing of the dashboard is fetched while Work is off, on load or on a change', async () => {
    vi.useFakeTimers()
    let emit: (e: ChangeEvent) => void = () => undefined
    mocked.onChange.mockImplementation((cb: (e: ChangeEvent) => void) => {
      emit = cb
      return () => undefined
    })
    await useWorkData.getState().load()
    await useWorkData.getState().load(['all', 'wins', 'general'])
    render(<Events />)
    act(() => emit({ kind: 'changed', path: 'Tasks/A.md', version: 'v2', origin: null }))
    await act(async () => {
      vi.advanceTimersByTime(EVENTS_DEBOUNCE_MS * 2)
    })
    noWorkCall()
    expect(useWorkData.getState().board).toBeNull()
    expect(useWorkData.getState().error).toEqual({})
    // On, the same call loads.
    setWorkOn(true)
    await useWorkData.getState().load(['board'])
    expect(mocked.workBoard).toHaveBeenCalledTimes(1)
  })

  test('test no work toast is queued or drawn while Work is off', () => {
    render(<WorkToasts />)
    act(() => {
      workToast('Could not save.')
      undoToast('Marked done', async () => undefined)
    })
    expect(useWorkToasts.getState().toasts).toEqual([])
    expect(document.querySelector('[data-work-toasts]')).toBeNull()
    act(() => setWorkOn(true))
    act(() => workToast('Could not save.'))
    expect(screen.getByRole('status')).toHaveTextContent('Could not save.')
    // Switched off with one showing: it is not drawn.
    act(() => setWorkOn(false))
    expect(screen.queryByRole('status')).toBeNull()
  })

  test('test no overlay opens while Work is off, and none is drawn or fetched for', async () => {
    render(<WorkOverlays />)
    act(() => {
      useWorkOverlay.getState().openSession('Tasks/A.md')
      useWorkOverlay.getState().openSmaller('Tasks/A.md', 's1')
    })
    expect(useWorkOverlay.getState().session).toBeNull()
    expect(useWorkOverlay.getState().smaller).toBeNull()
    // One left open when the switch goes off is not drawn either.
    useWorkOverlay.setState({ session: { path: 'Tasks/A.md' } })
    await act(async () => {})
    expect(screen.queryByRole('dialog')).toBeNull()
    noWorkCall()
  })

  test('test no keep-on-top window opens while Work is off, and the standalone mini page loads nothing', async () => {
    const requestWindow = vi.fn()
    ;(window as PipWindow).documentPictureInPicture = { requestWindow }
    await openWorkPip()
    expect(requestWindow).not.toHaveBeenCalled()

    // The standalone page asks the space; its answer here is Work off.
    resetSpaceInfo()
    mocked.space.mockResolvedValue({ name: 'space', root: '/space', types: [], workEnabled: false, workOn: false })
    const { container } = render(<WorkMini standalone />)
    await waitFor(() => expect(mocked.space).toHaveBeenCalled())
    await act(async () => {})
    noWorkCall()
    expect(container.querySelector('[data-work-mini]')).toBeEmptyDOMElement()
    expect(screen.queryByRole('textbox', { name: 'Brain dump' })).toBeNull()
    // Turned on: it loads and shows.
    act(() => setWorkOn(true))
    await waitFor(() => expect(mocked.workBoard).toHaveBeenCalled())
    expect(screen.getByRole('textbox', { name: 'Brain dump' })).toBeInTheDocument()
  })

  test('test the work header fetches no work item and shows nothing while Work is off', async () => {
    const { container } = render(<WorkHeader path="Tasks/A.md" work={async () => null} />)
    await act(async () => {})
    expect(mocked.workItem).not.toHaveBeenCalled()
    expect(container).toBeEmptyDOMElement()
    act(() => setWorkOn(true))
    await waitFor(() => expect(mocked.workItem).toHaveBeenCalledWith('Tasks/A.md'))
  })
})
