/**
 * M32 item 4 (the hands-on walk): Ctrl+Home did nothing in a note that starts with a to-do. The
 * browser's own "go to the start" lands on the to-do's box, which holds no caret, so the editor
 * moves the caret itself.
 */
import { Editor as TiptapEditor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { afterEach, describe, expect, test } from 'vitest'
import { editorExtensions, loadBody, serializeBody } from '../document'

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

/** Put the caret at the end of the text block holding `text`. */
function caretAtEndOf(editor: TiptapEditor, text: string): number {
  let pos = -1
  editor.state.doc.descendants((node, p) => {
    if (pos < 0 && node.isTextblock && node.textContent.includes(text)) pos = p + node.nodeSize - 1
    return pos < 0
  })
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)))
  return pos
}

/** Press Ctrl+`key` (with Shift when `shift`) as a browser sends it. */
function press(editor: TiptapEditor, key: 'Home' | 'End', shift = false): boolean {
  const event = new KeyboardEvent('keydown', { key, code: key, ctrlKey: true, shiftKey: shift, bubbles: true, cancelable: true })
  return editor.view.someProp('handleKeyDown', (f) => f(editor.view, event)) ?? false
}

const where = (editor: TiptapEditor) => {
  const { $from, empty } = editor.state.selection
  return { text: $from.parent.textContent, offset: $from.parentOffset, empty }
}

describe('Ctrl+Home and Ctrl+End move the caret to the ends of the note (M32)', () => {
  const TODO_FIRST = '- [x] first to-do\n- [ ] second\n\nSome text here.\n'

  test('test Ctrl+Home goes to the start of a note that starts with a to-do', () => {
    const editor = headless(TODO_FIRST)
    caretAtEndOf(editor, 'Some text here.')
    expect(press(editor, 'Home')).toBe(true)
    expect(where(editor)).toEqual({ text: 'first to-do', offset: 0, empty: true })
    // What is typed next goes there, and nothing else in the file changes.
    editor.commands.insertContent('Z')
    expect(serializeBody(editor)).toBe('- [x] Zfirst to-do\n- [ ] second\n\nSome text here.\n')
  })

  test('test Ctrl+Home goes to the start of a note that starts with text, a heading or a bullet', () => {
    for (const [body, first] of [
      ['Intro line.\n\nSecond.\n', 'Intro line.'],
      ['# Title\n\nSecond.\n', 'Title'],
      ['- one\n- two\n\nSecond.\n', 'one'],
    ]) {
      const editor = headless(body)
      caretAtEndOf(editor, 'Second.')
      expect(press(editor, 'Home')).toBe(true)
      expect(where(editor)).toEqual({ text: first, offset: 0, empty: true })
    }
  })

  test('test Ctrl+End goes to the end of the note, also when it ends with a to-do', () => {
    const editor = headless('Intro line.\n\n- [ ] one\n- [x] last to-do')
    editor.commands.setTextSelection(1)
    expect(press(editor, 'End')).toBe(true)
    const at = where(editor)
    expect(at.empty).toBe(true)
    // The caret is at the end of the last text there is.
    expect(editor.state.selection.to).toBe(TextSelection.atEnd(editor.state.doc).to)
    expect(at.offset).toBe(at.text.length)
  })

  test('test Ctrl+Shift+Home selects from the caret back to the start', () => {
    const editor = headless(TODO_FIRST)
    const anchor = caretAtEndOf(editor, 'Some text here.')
    expect(press(editor, 'Home', true)).toBe(true)
    const sel = editor.state.selection
    expect(sel.empty).toBe(false)
    expect(sel.anchor).toBe(anchor)
    expect(sel.head).toBe(TextSelection.atStart(editor.state.doc).from)
    expect(editor.state.doc.textBetween(sel.from, sel.to, '\n')).toBe('first to-do\nsecond\nSome text here.')
  })

  test('test Ctrl+Shift+End selects from the caret on to the end', () => {
    const editor = headless(TODO_FIRST)
    editor.commands.setTextSelection(TextSelection.atStart(editor.state.doc).from)
    expect(press(editor, 'End', true)).toBe(true)
    const sel = editor.state.selection
    expect(sel.anchor).toBe(TextSelection.atStart(editor.state.doc).from)
    expect(sel.head).toBe(TextSelection.atEnd(editor.state.doc).to)
  })

  test('test the keys change no text', () => {
    const editor = headless(TODO_FIRST)
    caretAtEndOf(editor, 'second')
    press(editor, 'Home')
    press(editor, 'End')
    press(editor, 'Home', true)
    expect(serializeBody(editor)).toBe(TODO_FIRST)
  })
})
