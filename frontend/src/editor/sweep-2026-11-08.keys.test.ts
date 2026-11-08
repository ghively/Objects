// The 2026-11-08 sweep: the catalogued editor keys Gene asked to bind ("bind the easy ones"),
// exercised in a live editor: Paste as plain text (Ctrl+Shift+V) and Open or close all toggles
// on the page (Ctrl+O).
import { Editor as TiptapEditor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { afterEach, describe, expect, test } from 'vitest'
import { keysFor } from '@/lib/shortcuts'
import { editorExtensions, loadBody, serializeBody } from './document'
import { armPlainPaste } from './extensions/pasteAsPlainText'

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

/** Put the cursor at the end of the first text block containing `text`. */
function cursorAtEndOf(editor: TiptapEditor, text: string): void {
  let pos = -1
  editor.state.doc.descendants((node, p) => {
    if (pos < 0 && node.isTextblock && node.textContent.includes(text)) pos = p + node.nodeSize - 1
    return pos < 0
  })
  if (pos < 0) throw new Error(`no block with ${text}`)
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)))
}

/**
 * Press the registry's key `spec` on the editor's DOM, as a browser sends it (not on macOS): a
 * real event, so ProseMirror's own key handling and the editor's key map both see it. Returns
 * whether the default was prevented.
 */
function press(editor: TiptapEditor, spec: string): boolean {
  const parts = spec.split('-')
  const key = parts.pop()!
  const mods = new Set(parts.map((m) => (m === 'AltCtrl' ? 'Alt' : m)))
  const letter = /^[a-z]$/i.test(key)
  const event = new KeyboardEvent('keydown', {
    key: letter && mods.has('Shift') ? key.toUpperCase() : key,
    code: letter ? `Key${key.toUpperCase()}` : key,
    ctrlKey: mods.has('Mod') || mods.has('Ctrl'),
    shiftKey: mods.has('Shift'),
    altKey: mods.has('Alt'),
    bubbles: true,
    cancelable: true,
  })
  if (letter) Object.defineProperty(event, 'keyCode', { value: key.toUpperCase().charCodeAt(0) })
  return !editor.view.dom.dispatchEvent(event)
}

function release(editor: TiptapEditor, key: string): void {
  editor.view.dom.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true, cancelable: true }))
}

/** A paste event carrying both `text/html` and `text/plain`, as a copy from a web page does. */
function paste(editor: TiptapEditor, data: { html?: string; text: string }): void {
  const event = new Event('paste', { bubbles: true, cancelable: true }) as Event & { clipboardData: unknown }
  const types = data.html ? ['text/html', 'text/plain'] : ['text/plain']
  event.clipboardData = {
    getData: (type: string) => (type === 'text/plain' ? data.text : type === 'text/html' ? (data.html ?? '') : ''),
    types,
    files: [],
  }
  editor.view.dom.dispatchEvent(event)
}

const RICH = { html: '<p><strong>Bold</strong> text</p><ul><li>item</li></ul>', text: 'Bold text\nitem' }

const CLOSED = '<!-- toggle -->\n### Closed toggle\nHidden child paragraph.\n<!-- /toggle -->\n'
const OPEN = '<!-- toggle open -->\n### Server checklist\n- [ ] Patch the hosts\n<!-- /toggle -->\n'
const MIXED = `Intro.\n\n${CLOSED}\n${OPEN}\nAfter.\n`

describe('Open or close all toggles on the page (Ctrl+O)', () => {
  test('with a closed toggle on the page, the key opens every toggle; with all open, it closes them all', () => {
    expect(keysFor('toggleAllToggles')).toEqual(['Mod-o'])
    const editor = headless(MIXED)
    cursorAtEndOf(editor, 'Intro.')
    expect(press(editor, 'Mod-o')).toBe(true)
    const allOpen = MIXED.replace('<!-- toggle -->', '<!-- toggle open -->')
    expect(serializeBody(editor)).toBe(allOpen)
    press(editor, 'Mod-o')
    expect(serializeBody(editor)).toBe(allOpen.replaceAll('<!-- toggle open -->', '<!-- toggle -->'))
    // And open again: the file's open lines only (the rest of the text is untouched).
    press(editor, 'Mod-o')
    expect(serializeBody(editor)).toBe(allOpen)
  })

  test('the key is consumed in the editor (no browser "Open file"), and a read-only editor changes nothing', () => {
    const editor = headless('No toggles here.\n')
    cursorAtEndOf(editor, 'No toggles')
    expect(press(editor, 'Mod-o')).toBe(true)
    expect(serializeBody(editor)).toBe('No toggles here.\n')
    const readOnly = headless(MIXED)
    readOnly.setEditable(false)
    press(readOnly, 'Mod-o')
    expect(serializeBody(readOnly)).toBe(MIXED)
  })
})

describe('Paste as plain text (Ctrl+Shift+V)', () => {
  test('the key is the registry’s, and the clipboard’s plain text lands as paragraphs, ignoring the HTML', () => {
    expect(keysFor('pasteAsPlainText')).toEqual(['Mod-Shift-v'])
    const editor = headless('Start here.\n\nAfter.\n')
    cursorAtEndOf(editor, 'Start here.')
    // The key is not swallowed: the browser must still fire the paste event.
    expect(press(editor, 'Mod-Shift-v')).toBe(false)
    paste(editor, RICH)
    release(editor, 'V')
    expect(serializeBody(editor)).toBe('Start here.Bold text\n\nitem\n\nAfter.\n')
    let marks = 0
    editor.state.doc.descendants((node) => {
      marks += node.marks.length
    })
    expect(marks).toBe(0)
  })

  test('plain text is not read as Markdown either: a pasted heading line stays a paragraph of text', () => {
    const editor = headless('P\n')
    cursorAtEndOf(editor, 'P')
    press(editor, 'Mod-Shift-v')
    paste(editor, { text: '# Not a heading\n\n* not a list' })
    release(editor, 'V')
    expect(serializeBody(editor)).toBe('P# Not a heading\n\n\\* not a list\n')
  })

  test('the registry’s handler alone makes the paste plain (no Shift seen by the editor view)', () => {
    const editor = headless('P\n')
    cursorAtEndOf(editor, 'P')
    armPlainPaste()
    paste(editor, RICH)
    expect(serializeBody(editor)).toBe('PBold text\n\nitem\n')
  })

  test('a plain Ctrl+V afterwards pastes normally again (the HTML is used)', () => {
    const editor = headless('P\n')
    cursorAtEndOf(editor, 'P')
    press(editor, 'Mod-Shift-v')
    paste(editor, { text: 'plain' })
    release(editor, 'V')
    press(editor, 'Mod-v')
    paste(editor, { html: '<p><strong>Bold</strong></p>', text: 'Bold' })
    release(editor, 'v')
    expect(serializeBody(editor)).toBe('Pplain**Bold**\n')
  })
})
