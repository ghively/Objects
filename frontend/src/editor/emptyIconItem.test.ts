/**
 * A list item with an icon and no text (`- <!-- item: icon=ph-star -->`, what
 * the `-() ` shortcut leaves before anything is typed) loads as a list item
 * with its options, not as a raw block, and saves byte for byte. The item
 * comment opening the item's text used to lex as an HTML comment block, which
 * the list item dropped, so the loader's check saw the comment lost.
 */
import { Editor as TiptapEditor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { afterEach, describe, expect, test } from 'vitest'
import type { Option } from './annotations'
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

function nodes(editor: TiptapEditor, type: string): PMNode[] {
  const out: PMNode[] = []
  editor.state.doc.descendants((node) => {
    if (node.type.name === type) out.push(node)
  })
  return out
}

function icons(editor: TiptapEditor): string[] {
  return nodes(editor, 'listItemOptions').map((n) => (n.attrs.options as Option[]).map((o) => o.raw).join(' '))
}

/** The Markdown the editor writes for the document when nothing is kept from the source. */
function regenerated(editor: TiptapEditor): string {
  return editor.markdown!.serialize({ type: 'doc', content: [editor.state.doc.toJSON().content[0]] })
}

describe('a list item with an icon and no text', () => {
  test('alone: loads as an icon item and saves byte for byte', () => {
    const body = '- <!-- item: icon=ph-star -->\n'
    const editor = headless(body)
    expect(nodes(editor, 'rawBlock')).toHaveLength(0)
    expect(nodes(editor, 'listItem')).toHaveLength(1)
    expect(icons(editor)).toEqual(['icon=ph-star'])
    expect(nodes(editor, 'listItem')[0].textContent).toBe('')
    expect(serializeBody(editor)).toBe(body)
    expect(regenerated(editor)).toBe('- <!-- item: icon=ph-star -->')
  })

  test('an emoji icon', () => {
    const body = '- <!-- item: icon="⭐" -->\n'
    const editor = headless(body)
    expect(nodes(editor, 'rawBlock')).toHaveLength(0)
    expect(icons(editor)).toEqual(['icon="⭐"'])
    expect(serializeBody(editor)).toBe(body)
  })

  test('between items with text', () => {
    const body = '- First\n- <!-- item: icon=ph-star -->\n- Third <!-- item: small -->\n'
    const editor = headless(body)
    expect(nodes(editor, 'rawBlock')).toHaveLength(0)
    expect(nodes(editor, 'listItem').map((n) => n.textContent)).toEqual(['First', '', 'Third '])
    expect(icons(editor)).toEqual(['icon=ph-star', 'small'])
    expect(serializeBody(editor)).toBe(body)
    expect(regenerated(editor)).toBe(body.trimEnd())
  })

  test('nested', () => {
    const body = '- Parent\n  - <!-- item: icon=ph-star -->\n  - Sibling\n- After\n'
    const editor = headless(body)
    expect(nodes(editor, 'rawBlock')).toHaveLength(0)
    expect(nodes(editor, 'listItem')).toHaveLength(4)
    expect(icons(editor)).toEqual(['icon=ph-star'])
    expect(serializeBody(editor)).toBe(body)
    expect(regenerated(editor)).toBe(body.trimEnd())
  })

  test('with a block id after the comment', () => {
    const body = '- <!-- item: icon=ph-star --> ^ab12cd\n'
    const editor = headless(body)
    expect(nodes(editor, 'rawBlock')).toHaveLength(0)
    expect(icons(editor)).toEqual(['icon=ph-star'])
    expect(serializeBody(editor)).toBe(body)
  })

  test('a to-do item', () => {
    const body = '- [ ] <!-- item: icon=ph-star -->\n'
    const editor = headless(body)
    expect(nodes(editor, 'rawBlock')).toHaveLength(0)
    expect(nodes(editor, 'taskItem')).toHaveLength(1)
    expect(icons(editor)).toEqual(['icon=ph-star'])
    expect(serializeBody(editor)).toBe(body)
  })

  test('CRLF is kept', () => {
    const body = '- First\r\n- <!-- item: icon=ph-star -->\r\n'
    const editor = headless(body)
    expect(nodes(editor, 'rawBlock')).toHaveLength(0)
    expect(serializeBody(editor)).toBe(body)
  })

  test('an edit elsewhere in the list leaves the empty icon item as it was', () => {
    const editor = headless('- First\n- <!-- item: icon=ph-star -->\n')
    let at = -1
    editor.state.doc.descendants((node, pos) => {
      if (node.isText && node.text === 'First') at = pos + node.nodeSize
    })
    editor.commands.insertContentAt(at, '!')
    expect(serializeBody(editor)).toBe('- First!\n- <!-- item: icon=ph-star -->\n')
  })

  test('a plain empty item is unchanged', () => {
    for (const body of ['- \n', '- A\n- \n- B\n']) {
      const editor = headless(body)
      expect(nodes(editor, 'rawBlock')).toHaveLength(0)
      expect(nodes(editor, 'listItemOptions')).toHaveLength(0)
      expect(serializeBody(editor)).toBe(body)
    }
  })

  test('an item comment outside a list stays a raw block', () => {
    const editor = headless('<!-- item: icon=ph-star -->\n')
    expect(nodes(editor, 'rawBlock')).toHaveLength(1)
    expect(nodes(editor, 'listItemOptions')).toHaveLength(0)
  })
})

describe('an item line that opens with an item comment', () => {
  test('a continuation line stays in the item\'s paragraph', () => {
    const body = '- <!-- item: small --> Buy\n  more text\n'
    const editor = headless(body)
    expect(nodes(editor, 'rawBlock')).toHaveLength(0)
    expect(nodes(editor, 'listItem')).toHaveLength(1)
    const item = nodes(editor, 'listItem')[0]
    expect(item.childCount).toBe(1)
    expect(item.firstChild!.type.name).toBe('paragraph')
    expect(item.textContent).toBe(' Buy\nmore text')
    expect(icons(editor)).toEqual(['small'])
    expect(serializeBody(editor)).toBe(body)
  })

  test('a continuation line, then a nested list and a sibling', () => {
    const body = '- <!-- item: small --> Buy\n  more text\n  - Child\n- Next\n'
    const editor = headless(body)
    expect(nodes(editor, 'rawBlock')).toHaveLength(0)
    expect(nodes(editor, 'listItem').map((n) => n.firstChild!.textContent)).toEqual([' Buy\nmore text', 'Child', 'Next'])
    expect(serializeBody(editor)).toBe(body)
  })

  test('the paragraph ends at a blank line', () => {
    const body = '- <!-- item: small --> Buy\n  more text\n\n  Second paragraph\n'
    const editor = headless(body)
    expect(nodes(editor, 'rawBlock')).toHaveLength(0)
    expect(nodes(editor, 'listItem')[0].childCount).toBe(2)
    expect(serializeBody(editor)).toBe(body)
  })

  test('in a blockquote', () => {
    const body = '> <!-- item: icon=ph-star -->\n'
    const editor = headless(body)
    expect(serializeBody(editor)).toBe(body)
  })

  test('in a blockquote, with text and a continuation line', () => {
    const body = '> <!-- item: icon=ph-star --> Note\n> more\n'
    const editor = headless(body)
    expect(serializeBody(editor)).toBe(body)
  })

  test('a stray item comment line at the top level stays a raw block, unchanged', () => {
    for (const body of ['<!-- item: small -->\n', 'Before\n\n<!-- item: small --> text\nmore\n\nAfter\n']) {
      const editor = headless(body)
      expect(nodes(editor, 'rawBlock').length).toBeGreaterThan(0)
      expect(serializeBody(editor)).toBe(body)
    }
  })
})
