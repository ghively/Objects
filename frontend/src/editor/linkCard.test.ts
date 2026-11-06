import { Editor as TiptapEditor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { afterEach, describe, expect, test } from 'vitest'
import { editorExtensions, loadBody, serializeBody } from './document'
import { cardToLink, linkToCard, soleLinkBlock } from './linkCard'

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

function blockPos(editor: TiptapEditor, i: number): number {
  let pos = 0
  for (let k = 0; k < i; k++) pos += editor.state.doc.child(k).nodeSize
  return pos
}

/** Put the cursor inside block `i`. */
function cursorIn(editor: TiptapEditor, i: number): void {
  const at = blockPos(editor, i) + 1
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve(at))))
}

describe('linkCard', () => {
  test('test a card turns into a line holding the same inline link', () => {
    const editor = headless('Intro\n\n![[Ada Lovelace]]\n\nOutro\n')
    expect(cardToLink(editor, blockPos(editor, 1))).toBe(true)
    expect(serializeBody(editor)).toBe('Intro\n\n[[Ada Lovelace]]\n\nOutro\n')
  })

  test('test the label carries over and the card view option is dropped', () => {
    const editor = headless('<!-- block: view=wideCard -->\n![[Ada Lovelace|Ada]]\n')
    expect(cardToLink(editor, blockPos(editor, 0))).toBe(true)
    expect(serializeBody(editor)).toBe('[[Ada Lovelace|Ada]]\n')
  })

  test('test a line holding only a link turns into a card, and back', () => {
    const editor = headless('Intro\n\n[[Ada Lovelace|Ada]]\n\nOutro\n')
    cursorIn(editor, 1)
    expect(soleLinkBlock(editor)).toEqual({ pos: blockPos(editor, 1), target: 'Ada Lovelace', label: 'Ada' })
    expect(linkToCard(editor)).toBe(true)
    expect(serializeBody(editor)).toBe('Intro\n\n![[Ada Lovelace|Ada]]\n\nOutro\n')
    expect(cardToLink(editor, blockPos(editor, 1))).toBe(true)
    expect(serializeBody(editor)).toBe('Intro\n\n[[Ada Lovelace|Ada]]\n\nOutro\n')
  })

  test('test a link inside a sentence is not offered as a card', () => {
    const editor = headless('See [[Ada Lovelace]] for more\n')
    cursorIn(editor, 0)
    expect(soleLinkBlock(editor)).toBeNull()
    expect(linkToCard(editor)).toBe(false)
    expect(serializeBody(editor)).toBe('See [[Ada Lovelace]] for more\n')
  })

  test('test a line with two links is not offered as a card', () => {
    const editor = headless('[[Ada Lovelace]] [[Embedded target]]\n')
    cursorIn(editor, 0)
    expect(soleLinkBlock(editor)).toBeNull()
  })

  test('test cardToLink refuses a position that holds no card', () => {
    const editor = headless('Just text\n')
    expect(cardToLink(editor, 0)).toBe(false)
    expect(serializeBody(editor)).toBe('Just text\n')
  })
})
