/**
 * Regression tests for the editor findings of the 2026-11-07 bug audit
 * (`docs/superpowers/plans/bug-audit-2026-11-07.md`, numbers as there). The bar:
 * opening a note and editing one block never changes the rendered structure of
 * any block, and every other block's bytes stay as they were. A block the editor
 * cannot represent faithfully loads as a raw block.
 */
import { Editor as TiptapEditor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Marked } from 'marked'
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
  return editor
}

/** The textblocks loaded from the body (not the empty paragraph the editor keeps last). */
function textblocks(editor: TiptapEditor): { node: PMNode; pos: number }[] {
  const out: { node: PMNode; pos: number }[] = []
  editor.state.doc.descendants((node, pos) => {
    if (node.isTextblock) out.push({ node, pos })
    return true
  })
  const last = out[out.length - 1]
  if (last && last.node.type.name === 'paragraph' && last.node.content.size === 0 && last.node.attrs.blockOrigin == null)
    out.pop()
  return out
}

/** `body` saved after typing `Z` at the end of its `i`-th textblock. */
function editAt(body: string, i: number): string {
  const editor = headless(body)
  const tb = textblocks(editor)[i]
  editor.view.dispatch(editor.state.tr.insertText('Z', tb.pos + tb.node.nodeSize - 1))
  return serializeBody(editor)
}

const gfm = new Marked({ gfm: true })
const html = (s: string) => (gfm.parse(s) as string).replace(/\s+/g, ' ').trim()

/** Every edit of one textblock keeps the rest of `body` byte for byte (and so its structure). */
function expectEveryEditLocal(body: string): void {
  const count = textblocks(headless(body)).length
  for (let i = 0; i < count; i++) {
    const saved = editAt(body, i)
    const back = saved.replace('Z', '')
    expect({ i, back }).toEqual({ i, back: body })
    expect(html(back)).toBe(html(body))
  }
}

const topTypes = (editor: TiptapEditor) => {
  const out: string[] = []
  editor.state.doc.forEach((n) => {
    if (n.type.name !== 'paragraph' || n.content.size > 0 || n.attrs.blockOrigin != null) out.push(n.type.name)
  })
  return out
}

describe('#5 a nested list the editor would mis-nest', () => {
  // The DIFF inputs of the audit's nesting probe: `@tiptap/markdown` reads the
  // innermost ordered list as a sibling of its parent bullet.
  const misNested = [
    '1. a\n   - b\n     1. c\n        - d\n2. e\n',
    '1. a\n   - b\n     1. c\n',
    '1. a\n   - b\n      1. c\n',
    '10. a\n    - b\n      1. c\n',
    '1. a\n\n   - b\n\n     1. c\n',
    '1. a\n   - [ ] b\n     1. c\n',
  ]
  for (const body of misNested) {
    test(`an edit keeps the nesting: ${JSON.stringify(body)}`, () => {
      expect(serializeBody(headless(body))).toBe(body)
      expectEveryEditLocal(body)
    })
  }

  // The inputs the editor nests as GFM does still load as editable lists.
  const nestedOk: [string, string][] = [
    ['1. a\n   - b\n     - c\n2. e\n', 'orderedList'],
    ['- a\n  1. b\n     - c\n- e\n', 'bulletList'],
    ['1. a\n   1. b\n      1. c\n', 'orderedList'],
    ['- a\n  - b\n    - c\n- d\n', 'bulletList'],
    ['- a\n  - b\n    1. c\n', 'bulletList'],
    ['- a\n    - b\n        1. c\n', 'bulletList'],
    ['- [ ] a\n  - [ ] b\n    1. c\n', 'taskList'],
    ['- a\n  1. b\n- c\n  1. d\n', 'bulletList'],
    ['1. a\n   - b\n2. c\n   - d\n', 'orderedList'],
  ]
  for (const [body, type] of nestedOk) {
    test(`still an editable list: ${JSON.stringify(body)}`, () => {
      expect(topTypes(headless(body))).toEqual([type])
      expectEveryEditLocal(body)
    })
  }
})
