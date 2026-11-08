// The 2026-11-08 sweep, round 3: Merge the selected text blocks (Ctrl+Shift+G, the catalog's
// Block editing group), exercised in a live editor. Only the merged blocks' lines change; every
// other byte of the body stays.
import { Editor as TiptapEditor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { afterEach, describe, expect, test } from 'vitest'
import { keysFor } from '@/lib/shortcuts'
import { editorExtensions, loadBody, serializeBody } from '../document'
import { getBlockSelection, selectBlocks } from './blockSelection'
import { mergeTextBlocks } from './mergeTextBlocks'

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

/** Select the blocks from the one holding `from` to the one holding `to`. */
function select(editor: TiptapEditor, from: string, to: string): void {
  expect(selectBlocks(editor, blockPos(editor, from), blockPos(editor, to))).toBe(true)
}

/** Press Ctrl+Shift+G on the editor's DOM as a browser sends it; whether the default was prevented. */
function pressMerge(editor: TiptapEditor): boolean {
  const event = new KeyboardEvent('keydown', { key: 'G', code: 'KeyG', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true })
  Object.defineProperty(event, 'keyCode', { value: 71 })
  return !editor.view.dom.dispatchEvent(event)
}

const BODY = 'Intro.\n\nFirst *one*.\n\nSecond **two**.\n\nThird.\n\n## Heading\n\n- a list\n- of two\n\nLast.\n'

describe('Merge the selected text blocks (Ctrl+Shift+G)', () => {
  test('the key is the registry’s, distinct from Group (Ctrl+G)', () => {
    expect(keysFor('mergeTextBlocks')).toEqual(['Mod-Shift-g'])
    expect(keysFor('groupBlocks')).toEqual(['Mod-g'])
  })

  test('two selected paragraphs become one, joined by a space, their marks kept; the merged block stays selected', () => {
    const editor = headless(BODY)
    select(editor, 'First', 'Second')
    expect(pressMerge(editor)).toBe(true)
    expect(serializeBody(editor)).toBe(BODY.replace('First *one*.\n\nSecond **two**.', 'First *one*. Second **two**.'))
    expect(getBlockSelection(editor.state)).not.toBeNull()
    // Again, with the block after: three paragraphs in one.
    const merged = blockPos(editor, 'First')
    expect(selectBlocks(editor, merged, blockPos(editor, 'Third'))).toBe(true)
    pressMerge(editor)
    expect(serializeBody(editor)).toBe(BODY.replace('First *one*.\n\nSecond **two**.\n\nThird.', 'First *one*. Second **two**. Third.'))
  })

  test('the blank lines after the last merged block stay as they were, and the line endings too', () => {
    const editor = headless('A\n\nB\n\n\nC\n')
    select(editor, 'A', 'B')
    pressMerge(editor)
    expect(serializeBody(editor)).toBe('A B\n\n\nC\n')
    const crlf = headless('A\r\n\r\nB\r\n\r\nC\r\n')
    select(crlf, 'B', 'C')
    pressMerge(crlf)
    expect(serializeBody(crlf)).toBe('A\r\n\r\nB C\r\n')
  })

  test('the first block keeps its options line; a block id in a block that is not the last is dropped', () => {
    const editor = headless('<!-- block: color=bg-red -->\nRed one ^ab12cd\n\nTwo ^ef34gh\n\nAfter.\n')
    select(editor, 'Red one', 'Two')
    pressMerge(editor)
    expect(serializeBody(editor)).toBe('<!-- block: color=bg-red -->\nRed one Two ^ef34gh\n\nAfter.\n')
  })

  test('a selection with a heading or a list in it is left alone (the key is consumed); one block or no block selection leaves the key to the browser', () => {
    const editor = headless(BODY)
    select(editor, 'Third', 'Heading')
    expect(pressMerge(editor)).toBe(true)
    expect(serializeBody(editor)).toBe(BODY)
    select(editor, 'Heading', 'Last')
    pressMerge(editor)
    expect(serializeBody(editor)).toBe(BODY)
    select(editor, 'Second', 'Second')
    expect(pressMerge(editor)).toBe(false)
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 2)))
    expect(pressMerge(editor)).toBe(false)
    expect(serializeBody(editor)).toBe(BODY)
  })

  test('a read-only editor changes nothing', () => {
    const editor = headless(BODY)
    select(editor, 'First', 'Second')
    editor.setEditable(false)
    expect(mergeTextBlocks(editor)).toBe(false)
    expect(serializeBody(editor)).toBe(BODY)
  })
})
