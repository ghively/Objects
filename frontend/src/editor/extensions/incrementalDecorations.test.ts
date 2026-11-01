/**
 * Decoration plugins recompute only the top-level blocks a transaction touched
 * (audit 2026-11-01 F8): the visitor runs over those blocks alone, the other
 * blocks' decorations are mapped, and attribute changes count as touches.
 */
import { Editor as TiptapEditor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Decoration } from '@tiptap/pm/view'
import { afterEach, describe, expect, test } from 'vitest'
import { editorExtensions, loadBody } from '../document'
import { CodeBlockLockKey } from '../nodes/codeBlock'
import { formulaCellsKey } from '../table/FormulaCell'
import { buildDecorations, changedRanges, updateDecorations, type DecorationVisitor } from './incrementalDecorations'

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

/** Position of the end of the first textblock containing `needle`. */
function endOf(editor: TiptapEditor, needle: string): number {
  let at = -1
  editor.state.doc.descendants((n, p) => {
    if (at < 0 && n.isTextblock && n.textContent.includes(needle)) at = p + 1 + n.content.size
    return at < 0
  })
  if (at < 0) throw new Error(`no ${needle}`)
  return at
}

/** A visitor marking every paragraph, and recording which top-level blocks it was run over. */
function tracingVisitor(seen: string[]): DecorationVisitor {
  return (node: PMNode, pos, decos) => {
    if (node.isTextblock) {
      seen.push(node.textContent)
      decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'seen' }))
      return false
    }
    return true
  }
}

describe('updateDecorations', () => {
  test('an edit runs the visitor over its own block only and keeps the others mapped', () => {
    const editor = headless('one\n\ntwo\n\nthree\n')
    const seen: string[] = []
    const visit = tracingVisitor(seen)
    const initial = buildDecorations(editor.state.doc, visit)
    expect(seen).toEqual(['one', 'two', 'three'])
    seen.length = 0
    const tr = editor.state.tr.insertText('X', endOf(editor, 'two'))
    const next = updateDecorations(initial, tr, visit)
    expect(seen).toEqual(['twoX'])
    const ranges = next.find().map((d) => [d.from, d.to])
    expect(ranges).toEqual([
      [0, 5],
      [5, 11],
      [11, 18],
    ])
  })

  test('a change on a block boundary rebuilds both neighbours', () => {
    const editor = headless('one\n\ntwo\n\nthree\n')
    const seen: string[] = []
    const visit = tracingVisitor(seen)
    const initial = buildDecorations(editor.state.doc, visit)
    seen.length = 0
    // Delete the whole second paragraph: a zero-width change between "one" and "three".
    const tr = editor.state.tr.delete(5, 10)
    updateDecorations(initial, tr, visit)
    expect(seen).toEqual(['one', 'three'])
  })

  test('an attribute change counts as a touch of its block', () => {
    const editor = headless('one\n\ntwo\n')
    const seen: string[] = []
    const visit = tracingVisitor(seen)
    const initial = buildDecorations(editor.state.doc, visit)
    seen.length = 0
    const tr = editor.state.tr.setNodeAttribute(5, 'blockTrailing', '\n')
    expect(changedRanges(tr)).toEqual([[5, 6]])
    updateDecorations(initial, tr, visit)
    expect(seen).toEqual(['two'])
  })

  test('without a document change and without positions the set is returned as is', () => {
    const editor = headless('one\n')
    const visit = tracingVisitor([])
    const initial = buildDecorations(editor.state.doc, visit)
    expect(updateDecorations(initial, editor.state.tr, visit)).toBe(initial)
  })
})

describe('plugins on the helper', () => {
  test('a formula value follows an edit in its own table while another table keeps its decorations', () => {
    const editor = headless('| a | b |\n|---|---|\n| 1 | =A2+1 |\n\nbetween\n\n| c | d |\n|---|---|\n| 5 | =A2*2 |\n')
    // The caret out of both tables: no cell is being edited.
    editor.commands.setTextSelection(endOf(editor, 'between'))
    const widgets = () =>
      formulaCellsKey
        .getState(editor.state)!
        .decos.find()
        .map((d) => (d.spec as { key?: string }).key ?? '')
        .filter((k) => k.startsWith('formula-value'))
    expect(widgets()).toEqual(['formula-value:2:', 'formula-value:10:'])
    editor.view.dispatch(editor.state.tr.insertText('0', endOf(editor, '5')))
    expect(widgets()).toEqual(['formula-value:2:', 'formula-value:100:'])
  })

  test('the lock plugin tracks a lock set after load and keeps guarding the block', () => {
    const editor = headless('```\ncode\n```\n\nafter\n')
    expect(CodeBlockLockKey.getState(editor.state)!.find()).toHaveLength(0)
    editor.view.dispatch(editor.state.tr.setNodeAttribute(0, 'blockOptions', [{ key: 'lock', value: true, raw: 'lock' }]))
    expect(CodeBlockLockKey.getState(editor.state)!.find()).toHaveLength(1)
    const before = editor.state.doc.textContent
    editor.view.dispatch(editor.state.tr.insertText('X', endOf(editor, 'code')))
    expect(editor.state.doc.textContent).toBe(before)
    editor.view.dispatch(editor.state.tr.insertText('X', endOf(editor, 'after')))
    expect(editor.state.doc.textContent).toBe(before.replace('after', 'afterX'))
  })
})
