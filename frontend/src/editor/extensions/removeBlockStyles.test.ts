// The 2026-11-08 sweep, round 3: Remove block styles (Ctrl+Shift+X, the catalog's Block editing
// group), exercised in a live editor. Only the touched blocks' option lines change; every other
// byte of the body stays.
import { Editor as TiptapEditor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { afterEach, describe, expect, test } from 'vitest'
import { keysFor } from '@/lib/shortcuts'
import { editorExtensions, loadBody, serializeBody } from '../document'
import { getBlockSelection, selectBlocks } from './blockSelection'
import { removeBlockStyles } from './removeBlockStyles'

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

/** The start position of the first text block whose text contains `text`. */
function blockPos(editor: TiptapEditor, text: string): number {
  let pos = -1
  editor.state.doc.descendants((node, p) => {
    if (pos < 0 && node.isTextblock && node.textContent.includes(text)) pos = p
    return pos < 0
  })
  if (pos < 0) throw new Error(`no block with ${text}`)
  return pos
}

/** Put the cursor at the end of the first text block containing `text`. */
function cursorAtEndOf(editor: TiptapEditor, text: string): void {
  const pos = blockPos(editor, text)
  const node = editor.state.doc.nodeAt(pos)!
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos + node.nodeSize - 1)))
}

/** Press Ctrl+Shift+X on the editor's DOM as a browser sends it; whether the default was prevented. */
function pressRemove(editor: TiptapEditor): boolean {
  const event = new KeyboardEvent('keydown', { key: 'X', code: 'KeyX', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true })
  Object.defineProperty(event, 'keyCode', { value: 88 })
  return !editor.view.dom.dispatchEvent(event)
}

const BODY =
  'Plain.\n\n<!-- block: color=bg-red align=center -->\nColored and centered.\n\n<!-- block: small -->\nFine print.\n\n<!-- toggle open -->\n### Open toggle\n<!-- block: color=text-blue -->\nBlue child.\n<!-- /toggle -->\n\n- Buy milk\n- Call Ada <!-- item: small color=text-red -->\n- Book trip\n\nLast.\n'

describe('Remove block styles (Ctrl+Shift+X)', () => {
  test('the key is the registry’s', () => {
    expect(keysFor('removeBlockStyles')).toEqual(['Mod-Shift-x'])
  })

  test('the block with the cursor loses its color and alignment: its options line goes, nothing else moves', () => {
    const editor = headless(BODY)
    cursorAtEndOf(editor, 'Colored and centered.')
    expect(pressRemove(editor)).toBe(true)
    expect(serializeBody(editor)).toBe(BODY.replace('<!-- block: color=bg-red align=center -->\n', ''))
    // Again: nothing left to remove, the key is still the editor's.
    expect(pressRemove(editor)).toBe(true)
    expect(serializeBody(editor)).toBe(BODY.replace('<!-- block: color=bg-red align=center -->\n', ''))
  })

  test('a small paragraph becomes standard text', () => {
    const editor = headless(BODY)
    cursorAtEndOf(editor, 'Fine print.')
    pressRemove(editor)
    expect(serializeBody(editor)).toBe(BODY.replace('<!-- block: small -->\nFine print.', 'Fine print.'))
  })

  test('with a block selection every selected block is cleared, and the selection stays', () => {
    const editor = headless(BODY)
    selectBlocks(editor, blockPos(editor, 'Plain.'), blockPos(editor, 'Fine print.'))
    pressRemove(editor)
    expect(serializeBody(editor)).toBe(
      BODY.replace('<!-- block: color=bg-red align=center -->\n', '').replace('<!-- block: small -->\nFine print.', 'Fine print.'),
    )
    expect(getBlockSelection(editor.state)).not.toBeNull()
  })

  test('inside a toggle only the child with the cursor changes; the toggle stays open', () => {
    const editor = headless(BODY)
    cursorAtEndOf(editor, 'Blue child.')
    pressRemove(editor)
    expect(serializeBody(editor)).toBe(BODY.replace('<!-- block: color=text-blue -->\nBlue child.', 'Blue child.'))
  })

  test('the cursor in a list item clears that item’s own comment (the BlockStyleMenu’s item options)', () => {
    const editor = headless(BODY)
    cursorAtEndOf(editor, 'Call Ada')
    expect(pressRemove(editor)).toBe(true)
    expect(serializeBody(editor)).toBe(BODY.replace('- Call Ada <!-- item: small color=text-red -->', '- Call Ada'))
  })

  test('a read-only editor leaves the key alone and changes nothing', () => {
    const editor = headless(BODY)
    editor.setEditable(false)
    cursorAtEndOf(editor, 'Colored and centered.')
    expect(removeBlockStyles(editor)).toBe(false)
    expect(serializeBody(editor)).toBe(BODY)
  })
})
