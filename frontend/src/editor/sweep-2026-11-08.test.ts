/**
 * Regression tests for the editor findings of the 2026-11-08 sweep that need a
 * live editor (the registry-level ones are in `lib/shortcuts.m8.test.ts`).
 */
import { Editor as TiptapEditor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { afterEach, describe, expect, test } from 'vitest'
import { editorExtensions, loadBody, serializeBody } from './document'

const editors: TiptapEditor[] = []
afterEach(() => {
  while (editors.length) editors.pop()!.destroy()
})

function headless(body: string): TiptapEditor {
  const editor = new TiptapEditor({ extensions: editorExtensions() })
  loadBody(editor, body)
  editors.push(editor)
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 2)))
  return editor
}

function press(editor: TiptapEditor, key: string, mods: { ctrl?: boolean; shift?: boolean; alt?: boolean } = {}): boolean {
  const event = new KeyboardEvent('keydown', {
    key,
    ctrlKey: !!mods.ctrl,
    shiftKey: !!mods.shift,
    altKey: !!mods.alt,
    bubbles: true,
    cancelable: true,
  })
  return editor.view.someProp('handleKeyDown', (f) => f(editor.view, event)) ?? false
}

describe('#3 the catalog keys for toggles and underline', () => {
  test('Ctrl+Down and Ctrl+Up open and close the toggle holding the cursor', () => {
    const toggle = headless('<!-- toggle open -->\nHello\n\nChild\n<!-- /toggle -->\n')
    expect(press(toggle, 'ArrowDown', { ctrl: true })).toBe(true)
    expect(serializeBody(toggle)).toBe('<!-- toggle -->\nHello\n\nChild\n<!-- /toggle -->\n')
    expect(press(toggle, 'ArrowUp', { ctrl: true })).toBe(true)
    expect(serializeBody(toggle)).toBe('<!-- toggle open -->\nHello\n\nChild\n<!-- /toggle -->\n')
    // The keys the sheet showed before stay.
    expect(press(toggle, 'Enter', { ctrl: true })).toBe(true)
    expect(serializeBody(toggle)).toBe('<!-- toggle -->\nHello\n\nChild\n<!-- /toggle -->\n')
  })

  test('Ctrl+U no longer underlines in the editor (the catalog leaves Underline unbound; Ctrl+U is "Add new content")', () => {
    const editor = headless('Hello\n')
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, 6)))
    expect(press(editor, 'u', { ctrl: true })).toBe(false)
    expect(serializeBody(editor)).toBe('Hello\n')
  })
})
