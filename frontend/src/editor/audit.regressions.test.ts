/**
 * Regression tests for the editor findings of the 2026-10-28 audit
 * (`docs/superpowers/plans/audit-2026-10-28.md`): each loads a body into a
 * headless editor, applies an edit, saves, and checks the saved Markdown and
 * what it reloads as.
 */
import { Editor as TiptapEditor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { afterEach, describe, expect, test } from 'vitest'
import { editorExtensions, loadBody, serializeBody } from './document'
import { moveBlockTo } from './handles/dragMove'

const editors: TiptapEditor[] = []
afterEach(() => {
  while (editors.length) editors.pop()!.destroy()
})

function headless(body: string, opts?: Parameters<typeof editorExtensions>[0]): TiptapEditor {
  const editor = new TiptapEditor({ extensions: editorExtensions(opts) })
  loadBody(editor, body)
  editors.push(editor)
  return editor
}

/** Top-level node types and their text, for comparing what a body loads as. */
function shape(editor: TiptapEditor): [string, string][] {
  const out: [string, string][] = []
  editor.state.doc.forEach((n) => out.push([n.type.name, n.textContent]))
  return out
}

/** The first node (of `type`, or any textblock) whose text contains `needle`. */
export function find(editor: TiptapEditor, needle: string, type?: string): { node: PMNode; pos: number } {
  let found: { node: PMNode; pos: number } | null = null
  editor.state.doc.descendants((node, pos) => {
    if (found) return false
    const ok = type ? node.type.name === type : node.isTextblock
    if (ok && node.textContent.includes(needle)) {
      found = { node, pos }
      return false
    }
    return true
  })
  if (!found) throw new Error(`no node with ${needle}`)
  return found
}

/** Top-level position of the block whose text contains `needle`. */
function topPos(editor: TiptapEditor, needle: string): number {
  let at = -1
  editor.state.doc.forEach((n, offset) => {
    if (at < 0 && n.textContent.includes(needle)) at = offset
  })
  if (at < 0) throw new Error(`no block with ${needle}`)
  return at
}

describe('dragging a block', () => {
  test('moving the last paragraph to the top keeps the paragraphs apart', () => {
    const editor = headless('A\n\nB\n\nC\n')
    moveBlockTo(editor, topPos(editor, 'C'), 0)
    const saved = serializeBody(editor)
    expect(shape(headless(saved))).toEqual([
      ['paragraph', 'C'],
      ['paragraph', 'A'],
      ['paragraph', 'B'],
    ])
    expect(saved.startsWith('C\n\nA\n\nB')).toBe(true)
  })

  test('a heading directly followed by its paragraph stays as written', () => {
    const body = '# H\nText\n\nP\n'
    const editor = headless(body)
    expect(serializeBody(editor)).toBe(body)
  })
})
