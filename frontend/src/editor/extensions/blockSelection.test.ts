import { Editor as TiptapEditor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { editorExtensions, loadBody, serializeBody } from '../document'
import { blocksSource, blockSelectionRange, getBlockSelection, selectBlocks } from './blockSelection'

const editors: TiptapEditor[] = []
afterEach(() => {
  while (editors.length) editors.pop()!.destroy()
})

function headless(body: string): TiptapEditor {
  const editor = new TiptapEditor({ extensions: editorExtensions() })
  loadBody(editor, body)
  editors.push(editor)
  return editor
}

/** Start position of top-level block `i`. */
function blockPos(editor: TiptapEditor, i: number): number {
  let pos = 0
  for (let k = 0; k < i; k++) pos += editor.state.doc.child(k).nodeSize
  return pos
}

function cursorIn(editor: TiptapEditor, text: string) {
  let at = -1
  editor.state.doc.descendants((node, pos) => {
    if (at < 0 && node.isTextblock && node.textContent.includes(text)) at = pos + 1
  })
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, at + 1)))
}

function press(editor: TiptapEditor, key: string, mods: { ctrl?: boolean; shift?: boolean; alt?: boolean } = {}): boolean {
  // As a browser sends it: a shifted letter comes upper case, with its key code.
  const letter = /^[a-z]$/.test(key)
  const event = new KeyboardEvent('keydown', {
    key: letter && mods.shift ? key.toUpperCase() : key,
    ctrlKey: !!mods.ctrl,
    shiftKey: !!mods.shift,
    altKey: !!mods.alt,
    bubbles: true,
    cancelable: true,
  })
  if (letter) Object.defineProperty(event, 'keyCode', { value: key.toUpperCase().charCodeAt(0) })
  return editor.view.someProp('handleKeyDown', (f) => f(editor.view, event)) ?? false
}

function selectedTexts(editor: TiptapEditor): string[] {
  return blockSelectionRange(editor.state)?.blocks.map((b) => b.node.textContent.trim()) ?? []
}

const BODY = 'A *one*  \n\n<!-- block: small -->\nB _two_\n\nC three\n\nD four\n'

describe('block selection', () => {
  test('block selection: escape, shift arrows, select all twice, delete, duplicate, move, indent', () => {
    const editor = headless(BODY)
    cursorIn(editor, 'B two')

    // Escape selects the block holding the cursor.
    expect(press(editor, 'Escape')).toBe(true)
    expect(selectedTexts(editor)).toEqual(['B two'])
    expect(editor.view.dom.classList.contains('has-block-selection')).toBe(true)
    expect(editor.view.dom.querySelectorAll('.block-selected')).toHaveLength(1)

    // Shift+Down / Shift+Up extend and shrink.
    press(editor, 'ArrowDown', { shift: true })
    expect(selectedTexts(editor)).toEqual(['B two', 'C three'])
    press(editor, 'ArrowUp', { shift: true })
    press(editor, 'ArrowUp', { shift: true })
    expect(selectedTexts(editor)).toEqual(['A one', 'B two'])

    // Mod-a selects the siblings, again the top level (here the same).
    press(editor, 'a', { ctrl: true })
    expect(selectedTexts(editor)).toEqual(['A one', 'B two', 'C three', 'D four'])

    // A selection change of its own (a click) clears it.
    cursorIn(editor, 'C three')
    expect(getBlockSelection(editor.state)).toBeNull()

    // Alt-Down (Capacities) moves the selection; Alt-Shift-Down too (on the same level).
    selectBlocks(editor, blockPos(editor, 2))
    press(editor, 'ArrowDown', { alt: true })
    expect(serializeBody(editor)).toBe('A *one*  \n\n<!-- block: small -->\nB _two_\n\nD four\n\nC three\n')
    expect(selectedTexts(editor)).toEqual(['C three'])
    press(editor, 'ArrowUp', { alt: true, shift: true })
    expect(serializeBody(editor)).toBe(BODY)
    // With the cursor in a block, Alt-Up/Down move that block (`moveUpBlockWithCursor`).
    cursorIn(editor, 'C three')
    expect(press(editor, 'ArrowDown', { alt: true })).toBe(true)
    expect(serializeBody(editor)).toBe('A *one*  \n\n<!-- block: small -->\nB _two_\n\nD four\n\nC three\n')
    expect(editor.state.selection.$from.parent.textContent).toBe('C three')
    press(editor, 'ArrowUp', { alt: true })
    expect(serializeBody(editor)).toBe(BODY)
    // Mod-Shift-Down no longer moves.
    selectBlocks(editor, blockPos(editor, 2))
    press(editor, 'ArrowDown', { ctrl: true, shift: true })
    expect(serializeBody(editor)).toBe(BODY)

    // Mod-d duplicates the selection (the copies become the selection).
    selectBlocks(editor, blockPos(editor, 1))
    press(editor, 'd', { ctrl: true })
    expect(serializeBody(editor)).toBe(
      'A *one*  \n\n<!-- block: small -->\nB _two_\n\n<!-- block: small -->\nB _two_\n\nC three\n\nD four\n',
    )
    expect(blockSelectionRange(editor.state)?.first).toBe(2)

    // Backspace deletes the selection.
    expect(press(editor, 'Backspace')).toBe(true)
    expect(serializeBody(editor)).toBe(BODY)

    // Shift-arrows, Backspace and Tab are left alone without a block selection.
    cursorIn(editor, 'A one')
    expect(getBlockSelection(editor.state)).toBeNull()
    expect(press(editor, 'ArrowDown', { shift: true })).toBe(false)
  })

  test('select all in a container selects its siblings, then the top level', () => {
    const editor = headless('Top\n\n<!-- toggle open -->\nLine\n\nChild one\n\nChild two\n<!-- /toggle -->\n\nEnd\n')
    cursorIn(editor, 'Child one')
    press(editor, 'a', { ctrl: true })
    expect(selectedTexts(editor)).toEqual(['Line', 'Child one', 'Child two'])
    press(editor, 'a', { ctrl: true })
    expect(blockSelectionRange(editor.state)?.blocks.map((b) => b.node.type.name)).toEqual(['paragraph', 'toggle', 'paragraph'])
  })

  test('typing replaces the selected blocks with a paragraph', () => {
    const editor = headless(BODY)
    selectBlocks(editor, blockPos(editor, 1), blockPos(editor, 2))
    const handled = editor.view.someProp('handleTextInput', (f) =>
      f(editor.view, editor.state.selection.from, editor.state.selection.to, 'x', () => editor.state.tr),
    )
    expect(handled).toBe(true)
    expect(serializeBody(editor)).toBe('A *one*  \n\nx\n\nD four\n')
    expect(getBlockSelection(editor.state)).toBeNull()
  })

  test('indent and unindent list items of the selected list', () => {
    const editor = headless('- one\n- two\n- three\n\nAfter\n')
    selectBlocks(editor, 0)
    expect(press(editor, 'Tab')).toBe(true)
    expect(serializeBody(editor)).toBe('- one\n  - two\n  - three\n\nAfter\n')
    expect(getBlockSelection(editor.state)).not.toBeNull()
    expect(press(editor, 'Tab', { shift: true })).toBe(true)
    expect(serializeBody(editor)).toBe('- one\n- two\n- three\n\nAfter\n')
  })

  test('copy of selected blocks gives their original source', () => {
    const body = 'A *one*  \r\n\r\n<!--block:color=bg-red-->\r\nB  __two__\r\n\r\n* x\r\n* y\r\n\r\nC\r\n'
    const editor = headless(body)
    selectBlocks(editor, blockPos(editor, 1), blockPos(editor, 2))
    // The blank line after the last block is not part of the copy.
    expect(blocksSource(editor)).toBe('<!--block:color=bg-red-->\r\nB  __two__\r\n\r\n* x\r\n* y')

    // Mod-c / Mod-x put it on the clipboard as text/plain.
    const setData = vi.fn()
    const copy = { clipboardData: { setData }, preventDefault: vi.fn() } as unknown as ClipboardEvent
    const handled = editor.view.someProp('handleDOMEvents', (h) => h.copy?.(editor.view, copy))
    expect(handled).toBe(true)
    expect(setData).toHaveBeenCalledWith('text/plain', '<!--block:color=bg-red-->\r\nB  __two__\r\n\r\n* x\r\n* y')

    const cut = { clipboardData: { setData: vi.fn() }, preventDefault: vi.fn() } as unknown as ClipboardEvent
    editor.view.someProp('handleDOMEvents', (h) => h.cut?.(editor.view, cut))
    expect(serializeBody(editor)).toBe('A *one*  \r\n\r\nC\r\n')
  })

  test('copy of an edited block gives its new source', () => {
    const editor = headless(BODY)
    cursorIn(editor, 'C three')
    editor.commands.insertContent('!')
    selectBlocks(editor, blockPos(editor, 2))
    expect(blocksSource(editor)).toBe('C! three')
  })
})
