/**
 * M31 item 11: the Page group's keys (catalog §2 Page): "Select all top-level blocks", "Copy
 * deep link", and Scroll to top Home, bottom End, page up/down. The registry lists them (so the
 * Shortcuts sheet does), and `usePageShortcuts` runs them for the active object view.
 */
import { Editor as TiptapEditor } from '@tiptap/core'
import { render } from '@testing-library/react'
import { createElement, useRef } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { ObjectSummary } from '@/api/types'
import { blockSelectionKey, selectTopLevelBlocks } from '@/editor/extensions/blockSelection'
import { editorExtensions, loadBody } from '@/editor/document'
import type { BodyEditorHandle } from '@/editor/useAutosave'
import { allShortcuts, formatKeys, keysFor } from '@/lib/shortcuts'
import { usePeek } from '@/nav/tabs'
import { DEEP_LINK_TEXT, deepLinkFor, scrollContainerOf, scrollPage, usePageShortcuts } from './pageShortcuts'

afterEach(() => {
  vi.restoreAllMocks()
  usePeek.setState({ path: null })
  document.body.innerHTML = ''
})

function setPlatform(p: string) {
  vi.spyOn(navigator, 'platform', 'get').mockReturnValue(p)
}

function press(init: KeyboardEventInit, target: EventTarget = document.body): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  target.dispatchEvent(e)
  return e
}

const summary = { path: 'Notes/Plan.md', id: 'id-plan', title: 'Plan', type: 'note', tags: [] } as unknown as ObjectSummary

describe('the Page group in the registry', () => {
  test('the catalog names, under Page; Home, End, Page Up and Page Down as catalogued', () => {
    const def = (id: string) => allShortcuts().find((d) => d.id === id)
    expect(def('selectAllTopLevelBlocks')?.name).toBe('Select all top-level blocks')
    expect(def('copyDeepLink')?.name).toBe('Copy deep link')
    expect(def('scrollToTop')?.name).toBe('Scroll to top')
    expect(def('scrollToBottom')?.name).toBe('Scroll to bottom')
    expect(def('scrollPageUp')?.name).toBe('Page up')
    expect(def('scrollPageDown')?.name).toBe('Page down')
    for (const id of ['selectAllTopLevelBlocks', 'copyDeepLink', 'scrollToTop', 'scrollToBottom', 'scrollPageUp', 'scrollPageDown']) {
      expect(def(id)?.category, id).toBe('page')
    }
    expect(keysFor('scrollToTop')).toEqual(['Home'])
    expect(keysFor('scrollToBottom')).toEqual(['End'])
    expect(keysFor('scrollPageUp')).toEqual(['PageUp'])
    expect(keysFor('scrollPageDown')).toEqual(['PageDown'])
    expect(def('scrollToTop')?.provisional).toBe(false)
  })

  test('the two keys the catalog leaves open are ours: Ctrl+Alt+Shift+A and Ctrl+Alt+Shift+L', () => {
    expect(formatKeys(keysFor('selectAllTopLevelBlocks')[0], false)).toBe('Ctrl+Alt+Shift+A')
    expect(formatKeys(keysFor('copyDeepLink')[0], false)).toBe('Ctrl+Alt+Shift+L')
    expect(formatKeys(keysFor('copyDeepLink')[0], true)).toBe('⌃⇧⌘L')
    expect(allShortcuts().find((d) => d.id === 'copyDeepLink')?.provisional).toBe(true)
    expect(allShortcuts().find((d) => d.id === 'selectAllTopLevelBlocks')?.provisional).toBe(true)
  })
})

describe('the handlers', () => {
  test('the deep link is the object reference other Copy actions write: [[Title]], or the path when the title cannot be a target', () => {
    expect(deepLinkFor(summary)).toBe('[[Plan]]')
    expect(deepLinkFor({ ...summary, title: 'C# notes', path: 'Notes/C# notes.md' })).toBe('[[Notes/C# notes]]')
  })

  test('select all top-level blocks selects every block of the top level as a block selection', () => {
    const editor = new TiptapEditor({ extensions: editorExtensions() })
    loadBody(editor, 'One\n\n- a\n  - b\n\n> quote\n\nLast\n')
    editor.commands.setTextSelection(8)
    expect(selectTopLevelBlocks(editor)).toBe(true)
    const sel = blockSelectionKey.getState(editor.state)
    expect(sel).toEqual({ anchor: 0, head: editor.state.doc.content.size - editor.state.doc.lastChild!.nodeSize })
    editor.destroy()
  })

  test('scrollPage: Home to the top, End to the bottom, page keys by most of a screen', () => {
    const el = document.createElement('div')
    Object.defineProperty(el, 'scrollHeight', { value: 3000 })
    Object.defineProperty(el, 'clientHeight', { value: 500 })
    el.scrollTop = 1000
    scrollPage(el, 'scrollToTop')
    expect(el.scrollTop).toBe(0)
    scrollPage(el, 'scrollToBottom')
    expect(el.scrollTop).toBe(3000)
    el.scrollTop = 1000
    scrollPage(el, 'scrollPageDown')
    expect(el.scrollTop).toBe(1450)
    scrollPage(el, 'scrollPageUp')
    expect(el.scrollTop).toBe(1000)
  })

  test('scrollContainerOf: the nearest ancestor that scrolls', () => {
    document.body.innerHTML = '<div id="outer" style="overflow-y: auto"><div id="mid"><div id="in"></div></div></div>'
    expect(scrollContainerOf(document.getElementById('in'))?.id).toBe('outer')
    expect(scrollContainerOf(null)).toBeNull()
  })
})

function Harness({ mode, handle, copy }: { mode: 'page' | 'peek'; handle: Partial<BodyEditorHandle>; copy?: (t: string) => void }) {
  const ref = useRef<BodyEditorHandle | null>(handle as BodyEditorHandle)
  usePageShortcuts({ mode, path: summary.path, summary, editorRef: ref, copy })
  return createElement(
    'div',
    { 'data-object-view': mode },
    createElement(
      'div',
      { id: 'scroller', style: { overflowY: 'auto' } },
      createElement('div', { 'data-object-path': summary.path }, createElement('input', { 'aria-label': 'field' })),
    ),
  )
}

describe('usePageShortcuts', () => {
  test('Home and End scroll the page outside fields, never while typing in one', () => {
    setPlatform('Win32')
    const r = render(createElement(Harness, { mode: 'page', handle: {} }))
    const scroller = document.getElementById('scroller')!
    Object.defineProperty(scroller, 'scrollHeight', { value: 2000 })
    Object.defineProperty(scroller, 'clientHeight', { value: 400 })
    scroller.scrollTop = 700
    expect(press({ key: 'Home' }).defaultPrevented).toBe(true)
    expect(scroller.scrollTop).toBe(0)
    press({ key: 'End' })
    expect(scroller.scrollTop).toBe(2000)
    scroller.scrollTop = 700
    press({ key: 'PageUp' })
    expect(scroller.scrollTop).toBe(340)
    scroller.scrollTop = 700
    const typing = press({ key: 'Home' }, r.getByLabelText('field'))
    expect(typing.defaultPrevented).toBe(false)
    expect(scroller.scrollTop).toBe(700)
    // Shift+End is a selection key, not a scroll.
    press({ key: 'End', shiftKey: true })
    expect(scroller.scrollTop).toBe(700)
  })

  test('Copy deep link copies [[Title]] from anywhere in the view, editor included; select all asks the editor', () => {
    setPlatform('Win32')
    const copy = vi.fn()
    const selectTop = vi.fn(() => true)
    const r = render(createElement(Harness, { mode: 'page', handle: { selectTopLevelBlocks: selectTop }, copy }))
    const e = press({ key: 'L', ctrlKey: true, altKey: true, shiftKey: true }, r.getByLabelText('field'))
    expect(e.defaultPrevented).toBe(true)
    expect(copy).toHaveBeenCalledWith('[[Plan]]')
    press({ key: 'A', ctrlKey: true, altKey: true, shiftKey: true })
    expect(selectTop).toHaveBeenCalledTimes(1)
  })

  test('the page keys stand down while a peek is open over the page (the peek is the active view)', () => {
    setPlatform('Win32')
    const copy = vi.fn()
    render(createElement(Harness, { mode: 'page', handle: {}, copy }))
    usePeek.setState({ path: 'Other.md' })
    const e = press({ key: 'L', ctrlKey: true, altKey: true, shiftKey: true })
    expect(e.defaultPrevented).toBe(false)
    expect(copy).not.toHaveBeenCalled()
  })

  test('the copied toast reads "Deep link copied"', () => {
    expect(DEEP_LINK_TEXT.copied).toBe('Deep link copied')
  })
})
