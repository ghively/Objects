import { Editor as TiptapEditor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { afterEach, describe, expect, test } from 'vitest'
import { editorExtensions, loadBody, serializeBody } from './document'
import { matchesSnapshot } from './extensions/blockSource'

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

function find(editor: TiptapEditor, pred: (n: PMNode) => boolean): { node: PMNode; pos: number } {
  let found: { node: PMNode; pos: number } | null = null
  editor.state.doc.descendants((node, pos) => {
    if (!found && pred(node)) found = { node, pos }
    return !found
  })
  if (!found) throw new Error('not found')
  return found
}

const textBlock = (editor: TiptapEditor, text: string) => find(editor, (n) => n.isTextblock && n.textContent === text)
const ofType = (editor: TiptapEditor, type: string) => find(editor, (n) => n.type.name === type)

const BODY = [
  'Top paragraph.',
  '',
  '<!-- group color=bg-blue -->',
  '',
  'First child.',
  '',
  '<!-- block: small -->',
  'Second child.',
  '',
  '<!-- /group -->',
  '',
  '<!-- columns -->',
  'Left.',
  '<!-- column -->',
  '',
  'Right.',
  '<!-- /columns -->',
  '',
].join('\n')

describe('BlockSource for nested blocks', () => {
  test('every nested block is stamped with its own source', () => {
    const editor = headless(BODY)
    const group = ofType(editor, 'group').node
    // The whole region, open line to close line (the blank line after it is the group's trailing).
    const region = BODY.slice(BODY.indexOf('<!-- group'), BODY.indexOf('<!-- columns'))
    expect(group.attrs.blockSource + (group.attrs.blockTrailing ?? '')).toBe(region)
    expect(group.attrs.containerOpen + group.attrs.containerLeading).toBe('<!-- group color=bg-blue -->\n\n')
    const first = textBlock(editor, 'First child.').node.attrs
    expect(first.blockSource).toBe(first.blockOrigin)
    expect(first.blockSource + first.blockTrailing).toBe('First child.\n\n')
    const second = textBlock(editor, 'Second child.').node.attrs
    expect(second.blockAnnotation).toBe('<!-- block: small -->\n')
    expect(second.blockSource + second.blockTrailing).toBe('Second child.\n\n')
    const right = find(editor, (n) => n.type.name === 'column' && n.textContent === 'Right.').node
    expect(right.attrs.separator + right.attrs.containerLeading).toBe('<!-- column -->\n\n')
    expect(right.attrs.blockSource).toMatch(/^<!-- column -->\n\nRight\.\n?$/)
  })

  test('an edit inside a container clears the container and the child, never the siblings', () => {
    const editor = headless(BODY)
    const first = textBlock(editor, 'First child.')
    editor.commands.insertContentAt(first.pos + first.node.nodeSize - 1, '!')
    expect(ofType(editor, 'group').node.attrs.blockSource).toBeNull()
    expect(textBlock(editor, 'First child.!').node.attrs.blockSource).toBeNull()
    expect(textBlock(editor, 'Second child.').node.attrs.blockSource).toMatch(/^Second child\.\n?$/)
    expect(textBlock(editor, 'Top paragraph.').node.attrs.blockSource).not.toBeNull()
    expect(ofType(editor, 'columns').node.attrs.blockSource).not.toBeNull()
    // Blank lines after the open line, between children and before the close line are kept.
    expect(serializeBody(editor)).toBe(BODY.replace('First child.', 'First child.!'))
  })

  test('an edit in one column clears that column only', () => {
    const editor = headless(BODY)
    const right = textBlock(editor, 'Right.')
    editor.commands.insertContentAt(right.pos + right.node.nodeSize - 1, '!')
    const columns = ofType(editor, 'columns').node
    expect(columns.attrs.blockSource).toBeNull()
    expect(columns.child(0).attrs.blockSource).toMatch(/^Left\.\n?$/)
    expect(columns.child(1).attrs.blockSource).toBeNull()
    expect(serializeBody(editor)).toBe(BODY.replace('Right.', 'Right.!'))
  })

  test('keep rule: restoring the original content regains the source', () => {
    const editor = headless(BODY)
    const first = textBlock(editor, 'First child.')
    const end = first.pos + first.node.nodeSize - 1
    editor.commands.insertContentAt(end, 'xyz')
    expect(ofType(editor, 'group').node.attrs.blockSource).toBeNull()
    editor.commands.deleteRange({ from: end, to: end + 3 })
    const group = ofType(editor, 'group').node
    expect(matchesSnapshot(editor, group)).toBe(true)
    expect(group.attrs.blockSource).toBe(group.attrs.blockOrigin)
    expect(textBlock(editor, 'First child.').node.attrs.blockSource).toMatch(/^First child\.\n?$/)
    expect(serializeBody(editor)).toBe(BODY)
  })

  test('an option change on a container keeps its children verbatim', () => {
    const editor = headless(BODY)
    editor.commands.setBlockOption('color', 'bg-red', ofType(editor, 'group').pos)
    expect(ofType(editor, 'group').node.attrs.blockSource).toBeNull()
    expect(textBlock(editor, 'First child.').node.attrs.blockSource).toMatch(/^First child\.\n?$/)
    expect(serializeBody(editor)).toBe(BODY.replace('<!-- group color=bg-blue -->', '<!-- group color=bg-red -->'))
    // Changing it back: the container is its loaded self again.
    editor.commands.setBlockOption('color', 'bg-blue', ofType(editor, 'group').pos)
    expect(ofType(editor, 'group').node.attrs.blockSource).not.toBeNull()
  })

  test('splitting a child gives the new block no source', () => {
    const editor = headless(BODY)
    const first = textBlock(editor, 'First child.')
    editor.commands.setTextSelection(first.pos + first.node.nodeSize - 1)
    editor.commands.splitBlock()
    editor.commands.insertContent('New')
    const added = textBlock(editor, 'New')
    expect(added.node.attrs.blockOrigin).toBeNull()
    expect(added.node.attrs.blockOptions).toBeNull()
    expect(serializeBody(editor)).toBe(BODY.replace('First child.\n', 'First child.\n\nNew\n'))
  })
})
