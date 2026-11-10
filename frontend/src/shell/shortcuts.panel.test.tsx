// M31 fix pass (D1 note): "Toggle right side panel" (Ctrl+Shift+Right) and its twin "Toggle left
// sidebar" (Ctrl+Shift+Left) stay out of text fields, where the browser extends the selection by
// a word with the same keys (our call: a field in the side panel keeps word selection; the panel
// closes from outside the field, the top bar button, or the palette).
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { isSidepanelShown } from '@/nav/sidepanel'
import { activeTab, useTabs } from '@/nav/tabs'
import { usePanelShortcuts } from './shortcuts'

function Harness({ toggleLeftSidebar }: { toggleLeftSidebar: () => void }) {
  usePanelShortcuts({ toggleLeftSidebar })
  return <input aria-label="In the side panel" />
}

function press(target: EventTarget, key: string): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key, ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true })
  act(() => {
    target.dispatchEvent(e)
  })
  return e
}

beforeEach(() => {
  vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Win32')
  localStorage.clear()
  useTabs.getState().reset()
  act(() => useTabs.getState().open({ kind: 'tasks' }))
})

afterEach(() => vi.restoreAllMocks())

describe('the panel keys and text fields', () => {
  test('Ctrl+Shift+Right toggles the side panel outside fields; in a field it is left to word selection', () => {
    const left = vi.fn()
    render(<Harness toggleLeftSidebar={left} />)
    const shown = () => isSidepanelShown(activeTab(useTabs.getState()))
    const before = shown()
    expect(press(document.body, 'ArrowRight').defaultPrevented).toBe(true)
    expect(shown()).toBe(!before)

    const field = screen.getByLabelText('In the side panel')
    field.focus()
    const inField = press(field, 'ArrowRight')
    expect(inField.defaultPrevented).toBe(false)
    expect(shown()).toBe(!before)
    expect(press(field, 'ArrowLeft').defaultPrevented).toBe(false)
    expect(left).not.toHaveBeenCalled()
  })
})
