// M8 Task 9: focus mode hides the shell's chrome and restores it; objects only.
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { usePeek, useTabs } from '@/nav/tabs'
import { FOCUS_ATTR, FocusMode } from './FocusMode'
import { FOCUS_TEXT, NO_TIMER, useFocusMode } from './useFocusMode'

function Chrome() {
  return (
    <div>
      <header>
        <div data-slot="tab-strip">tabs</div>
      </header>
      <aside aria-label="Sidebar">sidebar</aside>
      <div data-main-column="">
        <aside aria-label="Properties">props</aside>
        <div data-page-body="">body</div>
      </div>
      <aside aria-label="Side panel">side</aside>
    </div>
  )
}

const shown = (el: Element) => getComputedStyle(el).display !== 'none'

beforeEach(() => {
  localStorage.clear()
  useTabs.getState().reset()
  usePeek.getState().close()
  useFocusMode.setState({ on: false, timer: NO_TIMER, completed: null, notice: null })
})
afterEach(() => {
  useFocusMode.setState({ on: false })
})

describe('FocusMode', () => {
  test('test focus mode hides chrome and restores it', () => {
    useTabs.getState().open({ kind: 'object', path: 'Pages/Notes.md' })
    const { container } = render(
      <>
        <Chrome />
        <FocusMode />
      </>,
    )
    const parts = ['[data-slot="tab-strip"]', 'aside[aria-label="Sidebar"]', 'aside[aria-label="Properties"]', 'aside[aria-label="Side panel"]'].map(
      (s) => container.querySelector(s)!,
    )
    const body = container.querySelector('[data-page-body]')!
    for (const p of parts) expect(shown(p)).toBe(true)

    act(() => useFocusMode.getState().enter())
    expect(document.documentElement.hasAttribute(FOCUS_ATTR)).toBe(true)
    for (const p of parts) expect(shown(p)).toBe(false)
    expect(shown(body)).toBe(true)
    // The timer control appears while focusing.
    expect(screen.getByRole('button', { name: new RegExp(FOCUS_TEXT.label) })).toBeTruthy()

    act(() => useFocusMode.getState().leave())
    expect(document.documentElement.hasAttribute(FOCUS_ATTR)).toBe(false)
    expect(document.querySelector('style[data-focus-mode-style]')).toBeNull()
    // Every part is back exactly as it was (still in the DOM, nothing re-mounted).
    for (const p of parts) {
      expect(p.isConnected).toBe(true)
      expect(shown(p)).toBe(true)
    }
  })

  test('test focus unavailable off objects', () => {
    useTabs.getState().open({ kind: 'calendar' })
    render(
      <>
        <Chrome />
        <FocusMode />
      </>,
    )
    act(() => useFocusMode.getState().toggle())
    expect(useFocusMode.getState().on).toBe(false)
    expect(document.documentElement.hasAttribute(FOCUS_ATTR)).toBe(false)
    expect(screen.getByRole('status').textContent).toBe(FOCUS_TEXT.unavailable)
  })

  test('leaves focus mode when the tab moves off an object', () => {
    useTabs.getState().open({ kind: 'object', path: 'Pages/Notes.md' })
    render(<FocusMode />)
    act(() => useFocusMode.getState().enter())
    expect(useFocusMode.getState().on).toBe(true)
    act(() => useTabs.getState().open({ kind: 'trash' }))
    expect(useFocusMode.getState().on).toBe(false)
    expect(screen.getByRole('status').textContent).toBe(FOCUS_TEXT.unavailable)
  })

  test('Mod-Shift-m toggles focus mode', () => {
    useTabs.getState().open({ kind: 'object', path: 'Pages/Notes.md' })
    render(<FocusMode />)
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'M', ctrlKey: true, shiftKey: true, bubbles: true }))
    })
    expect(useFocusMode.getState().on).toBe(true)
  })
})
