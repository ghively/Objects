// M23 Task 16: the Work page's keys (Review Focus 1: they never act while Gene types).
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('../page/WorkPage', () => ({
  focusBrainDump: vi.fn(),
  focusWorkSearch: vi.fn(),
  clearWorkSearch: vi.fn(),
}))

vi.mock('../state/workActions', async (orig) => {
  const real = await orig<typeof import('../state/workActions')>()
  return { ...real, openItemPanel: vi.fn(real.openItemPanel) }
})

import { entriesOf } from '@/nav/sidepanel'
import { activeTab, usePeek, useTabs } from '@/nav/tabs'
import { resetSettingsModal, useSettingsModal } from '@/settings/useSettingsModal'
import { clearWorkSearch, focusBrainDump, focusWorkSearch } from '../page/WorkPage'
import { openItemPanel } from '../state/workActions'
import { useWorkSelection } from '../state/useWorkSelection'
import { loadWorkUi, useWorkUi } from '../state/useWorkUi'
import { useSpaceInfo } from '@/settings/useSpaceInfo'
import { registerWorkView, resetWorkViews, workViews } from '../views/registry'
import '../captures/registerView'
import '../tasklists/registerView'
import { useWorkKeys } from './useWorkKeys'

/** The glob-registered views `g i` and `g c` open, kept before `resetWorkViews` drops them. */
const DRIVE_GLOB_VIEWS = workViews().filter((v) => v.id === 'captures' || v.id === 'list-inbox')

const A = 'Tasks/Printer jams on line 3.md'
const B = 'Tasks/Waiting on Pat.md'
const C = 'Tasks/Badge reader.md'

function Harness({ dialog = false }: { dialog?: boolean }) {
  useWorkKeys()
  return (
    <div>
      <input aria-label="Brain dump" />
      <textarea aria-label="Answer" />
      <div data-testid="body" contentEditable suppressContentEditableWarning>
        <p data-testid="para">text</p>
      </div>
      <div className="cm-editor">
        <div data-testid="cm" className="cm-content" tabIndex={0} />
      </div>
      <button type="button" onClick={() => pressed()}>
        Done
      </button>
      {[A, B, C].map((p, i) => (
        <div key={p} data-work-row={p} aria-selected={i === useWorkSelection.getState().index} />
      ))}
      {dialog && <div role="dialog" aria-label="A dialog" />}
    </div>
  )
}

const pressed = vi.fn()
const press = (key: string, init: KeyboardEventInit = {}) =>
  fireEvent.keyDown(document.activeElement ?? document.body, { key, ...init })

function panelEntries() {
  return entriesOf(activeTab(useTabs.getState())).filter((e) => e.isOpen && e.target?.kind === 'object' && e.target.work)
}

describe('useWorkKeys', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-05T10:00:00.000Z'))
    vi.clearAllMocks()
    window.localStorage.clear()
    loadWorkUi(null)
    resetWorkViews()
    resetSettingsModal()
    usePeek.getState().close()
    useTabs.getState().reset()
    useTabs.getState().open({ kind: 'work' })
    useWorkSelection.setState({ list: [], index: -1 })
    useWorkSelection.getState().setList([A, B, C])
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  test('test keys never act in fields, editors, dialogs or on buttons', async () => {
    const user = userEvent.setup({ advanceTimers: () => {} })
    const r = render(<Harness />)
    const nothingHappened = () => {
      expect(focusBrainDump).not.toHaveBeenCalled()
      expect(focusWorkSearch).not.toHaveBeenCalled()
      expect(openItemPanel).not.toHaveBeenCalled()
      expect(useWorkSelection.getState().index).toBe(0)
      expect(useWorkUi.getState().view).toBe('now')
      expect(useSettingsModal.getState().shortcutsOpen).toBe(false)
      expect(usePeek.getState().path).toBeNull()
    }
    // `[[` is how user-event types `[`.
    const typed = 'bjgn[[/?'

    const dump = screen.getByLabelText('Brain dump') as HTMLInputElement
    await user.click(dump)
    await user.keyboard('bjgw[[/?')
    expect(dump.value).toBe('bjgw[/?')
    nothingHappened()

    const answer = screen.getByLabelText('Answer') as HTMLTextAreaElement
    await user.click(answer)
    await user.keyboard(typed)
    expect(answer.value).toBe('bjgn[/?')
    nothingHappened()

    // A contenteditable body and a CodeMirror element: the keys reach them, the page does nothing.
    answer.blur()
    for (const el of [screen.getByTestId('para'), screen.getByTestId('cm')]) {
      for (const key of ['b', 'j', 'g', 'w', '[', '/', '?', ' ', 'Enter']) {
        const ev = fireEvent.keyDown(el, { key })
        expect(ev).toBe(true) // not prevented: the text gets it
      }
      nothingHappened()
    }
    r.unmount()

    // With a dialog open nothing happens.
    const d = render(<Harness dialog />)
    for (const key of ['b', 'j', 'g', 'e', '[', '/', '?', ' ', 'Enter', 'Escape']) press(key)
    nothingHappened()
    expect(clearWorkSearch).not.toHaveBeenCalled()
    d.unmount()

    // Space and Enter on a focused button press the button and open no peek.
    render(<Harness />)
    const button = screen.getByRole('button', { name: 'Done' })
    button.focus()
    await user.keyboard(' ')
    await user.keyboard('{Enter}')
    expect(pressed).toHaveBeenCalledTimes(2)
    nothingHappened()
  })

  test('test g then a key opens the view', () => {
    render(<Harness />)
    press('g')
    press('w')
    expect(useWorkUi.getState().view).toBe('flow')
    press('g')
    press('e')
    expect(useWorkUi.getState().view).toBe('everything')
    press('g')
    press('l')
    expect(useWorkUi.getState().view).toBe('alerts')
    // A view key without `g` does nothing.
    press('w')
    expect(useWorkUi.getState().view).toBe('alerts')
    // It expires after 1500 ms.
    press('g')
    vi.setSystemTime(new Date(Date.now() + 1501))
    press('n')
    expect(useWorkUi.getState().view).toBe('alerts')
    press('g')
    vi.setSystemTime(new Date(Date.now() + 1500))
    press('n')
    expect(useWorkUi.getState().view).toBe('now')
  })

  test('D3: g then i opens Inbox and g then c opens Captures; g i does nothing while task lists are hidden', () => {
    expect(DRIVE_GLOB_VIEWS.map((v) => v.id).sort()).toEqual(['captures', 'list-inbox'])
    for (const v of DRIVE_GLOB_VIEWS) registerWorkView(v)
    render(<Harness />)
    press('g')
    press('i')
    expect(useWorkUi.getState().view).toBe('list-inbox')
    press('g')
    press('c')
    expect(useWorkUi.getState().view).toBe('captures')
    const space = useSpaceInfo.getState().space
    useSpaceInfo.setState({ space: { ...(space ?? {}), hideTaskManagement: true } as never })
    try {
      press('g')
      press('i')
      expect(useWorkUi.getState().view).toBe('captures')
    } finally {
      useSpaceInfo.setState({ space })
    }
  })

  test('test j k Enter Space', () => {
    render(<Harness />)
    press('j')
    expect(useWorkSelection.getState().selected()).toBe(B)
    press('j')
    press('j')
    expect(useWorkSelection.getState().selected()).toBe(C)
    press('k')
    expect(useWorkSelection.getState().selected()).toBe(B)
    press('Enter')
    expect(openItemPanel).toHaveBeenCalledWith(B)
    expect(panelEntries().map((e) => e.target)).toEqual([{ kind: 'object', path: B, work: true }])
    press(' ')
    expect(usePeek.getState().path).toBe(B)
    expect(usePeek.getState().list).toEqual([A, B, C])
  })

  test('test brackets move through items in the panel', () => {
    render(<Harness />)
    // Without the item panel the brackets only move the selection.
    press(']')
    expect(useWorkSelection.getState().selected()).toBe(B)
    expect(openItemPanel).not.toHaveBeenCalled()
    act(() => openItemPanel(B))
    vi.mocked(openItemPanel).mockClear()
    press(']')
    expect(useWorkSelection.getState().selected()).toBe(C)
    expect(openItemPanel).toHaveBeenLastCalledWith(C)
    expect(panelEntries().map((e) => e.target)).toEqual([{ kind: 'object', path: C, work: true }])
    press('[')
    press('[')
    expect(useWorkSelection.getState().selected()).toBe(A)
    expect(panelEntries().map((e) => e.target)).toEqual([{ kind: 'object', path: A, work: true }])
  })

  test('test esc closes the work panel', () => {
    render(<Harness />)
    useWorkUi.getState().setFocusLine(2)
    act(() => openItemPanel(A))
    expect(panelEntries()).toHaveLength(1)
    press('Escape')
    expect(panelEntries()).toHaveLength(0)
    // The panel went first: the focus line and the search are kept.
    expect(useWorkUi.getState().focusLine?.n).toBe(2)
    expect(clearWorkSearch).not.toHaveBeenCalled()
    press('Escape')
    expect(useWorkUi.getState().focusLine).toBeNull()
    expect(clearWorkSearch).toHaveBeenCalledTimes(1)
  })

  test('test question mark toggles the shortcut sheet', () => {
    render(<Harness />)
    press('?', { shiftKey: true })
    expect(useSettingsModal.getState().shortcutsOpen).toBe(true)
    press('?', { shiftKey: true })
    expect(useSettingsModal.getState().shortcutsOpen).toBe(false)
    // `/` and `b` focus the search and the brain-dump bar; `B` too.
    press('/')
    expect(focusWorkSearch).toHaveBeenCalledTimes(1)
    press('B', { shiftKey: true })
    press('b')
    expect(focusBrainDump).toHaveBeenCalledTimes(2)
    // A modifier other than Shift leaves the key alone.
    press('b', { ctrlKey: true })
    press('?', { altKey: true, shiftKey: true })
    expect(focusBrainDump).toHaveBeenCalledTimes(2)
    expect(useSettingsModal.getState().shortcutsOpen).toBe(false)
  })

  test('test calm mode keeps only g n', () => {
    render(<Harness />)
    useWorkUi.getState().setView('flow')
    useWorkUi.getState().setCalm(true)
    for (const k of ['w', 'p', 't', 'o', 'q', 'h', 's', 'y', 'l', 'e']) {
      press('g')
      press(k)
      expect(useWorkUi.getState().view, k).toBe('flow')
    }
    press('g')
    press('n')
    expect(useWorkUi.getState().view).toBe('now')
  })
})
