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

/** `body` saved after typing `Z` at the end of the first textblock whose text contains `needle`. */
function editWhere(body: string, needle: string): string {
  const i = textblocks(headless(body)).findIndex((tb) => tb.node.textContent.includes(needle))
  expect(i).toBeGreaterThanOrEqual(0)
  return editAt(body, i)
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

describe('#18 a GFM task item in an ordered list', () => {
  const body = '1. [ ] a\n2. [x] b\n'

  test('keeps its box when the item text is edited', () => {
    expect(serializeBody(headless(body))).toBe(body)
    expect(editAt(body, 0)).toBe('1. [ ] aZ\n2. [x] b\n')
    expect(editAt(body, 1)).toBe('1. [ ] a\n2. [x] bZ\n')
    expectEveryEditLocal(body)
  })

  test('still loads as an editable ordered list', () => {
    expect(topTypes(headless(body))).toEqual(['orderedList'])
  })

  test('an escaped box stays escaped: such a list loads raw', () => {
    const escaped = '1. \\[ ] a\n2. b\n'
    expect(topTypes(headless(escaped))).toEqual(['rawBlock'])
    expectEveryEditLocal(escaped)
  })

  test('a bullet item typed as `[ ] a` text stays text', () => {
    const editor = headless('- x\n')
    const tb = textblocks(editor)[0]
    editor.view.dispatch(editor.state.tr.insertText('[ ] a', tb.pos + 1, tb.pos + tb.node.nodeSize - 1))
    expect(serializeBody(editor)).toBe('- \\[ \\] a\n')
  })
})

describe('#17 an indented code block inside a list item', () => {
  const cases = [
    '- a\n\n      indented code in item\n- b\n',
    '1. a\n\n       code\n       more\n2. b\n',
    '- a\n  - b\n\n        nested code\n- c\n',
    '> - a\n>\n>       code\n',
  ]
  for (const body of cases) {
    test(`survives an edit to the item and to the code: ${JSON.stringify(body)}`, () => {
      expect(serializeBody(headless(body))).toBe(body)
      expectEveryEditLocal(body)
    })
  }

  test('a fenced code block in an item, and a top-level indented one, stay editable (#17)', () => {
    expect(topTypes(headless('- item\n\n  ```js\n  x\n  ```\n- next\n'))).toEqual(['bulletList'])
    expect(topTypes(headless('    code block\n    more\n'))).toEqual(['codeBlock'])
  })
})

describe('#26 a body with lone-CR line endings', () => {
  for (const body of ['a\rb\r', 'para one\r\rtwo\rlines\r\r- a\r- b\r', '# T\r\r1. x\r   - y\r']) {
    test(`an edit keeps CR line endings: ${JSON.stringify(body)}`, () => {
      expect(serializeBody(headless(body))).toBe(body)
      const count = textblocks(headless(body)).length
      for (let i = 0; i < count; i++) {
        const saved = editAt(body, i)
        expect(saved).not.toContain('\n')
        expect(saved.replace('Z', '')).toBe(body)
      }
    })
  }

  test('a new block is written with CR too', () => {
    const editor = headless('para one\r\rpara two\r')
    const last = textblocks(editor)[1]
    const end = last.pos + last.node.nodeSize
    editor.view.dispatch(editor.state.tr.insert(end, editor.schema.nodes.paragraph.create(null, editor.schema.text('new'))))
    expect(serializeBody(editor)).toBe('para one\r\rpara two\r\rnew\r')
  })
})

describe('#37 shortcut reference links and footnote definitions', () => {
  test('a shortcut reference whose label the body defines keeps its brackets', () => {
    const body = '[foo]: https://e.com\n\nsee [foo]\n'
    expect(editWhere(body, 'see')).toBe('[foo]: https://e.com\n\nsee [foo]Z\n')
    expectEveryEditLocal(body)
  })

  test('the label matches case-insensitively, blanks collapsed', () => {
    const body = 'see [Foo  Bar] and ![foo bar]\n\n[foo bar]: /x\n'
    expect(editWhere(body, 'see')).toBe('see [Foo  Bar] and ![foo bar]Z\n\n[foo bar]: /x\n')
  })

  test('brackets the body defines no label for stay escaped text', () => {
    expect(editWhere('see [foo]\n', 'see')).toBe('see \\[foo\\]Z\n')
    expect(editWhere('[bar]: /x\n\nsee [foo]\n', 'see')).toBe('[bar]: /x\n\nsee \\[foo\\]Z\n')
  })

  test('a footnote definition the body refers to is not escaped', () => {
    const body = 'Text[^1] here.\n\n[^1]: The note.\n'
    expect(editWhere(body, 'The note')).toBe('Text[^1] here.\n\n[^1]: The note.Z\n')
    expect(editWhere(body, 'Text')).toBe('Text[^1] here.Z\n\n[^1]: The note.\n')
  })

  test('a footnote definition nothing refers to stays escaped', () => {
    expect(editWhere('[^2]: lonely note\n', 'lonely')).toBe('\\[^2\\]: lonely noteZ\n')
  })

  test('a footnote definition that would read as a link definition stays escaped', () => {
    // `[^1]: oneword` is a link definition to Markdown, which would hide the text.
    const editor = headless('Text[^1] here.\n\n[^1]: The note.\n')
    const tb = textblocks(editor)[1]
    editor.view.dispatch(editor.state.tr.insertText('[^1]: word', tb.pos + 1, tb.pos + tb.node.nodeSize - 1))
    expect(serializeBody(editor)).toBe('Text[^1] here.\n\n\\[^1\\]: word\n')
  })
})

describe('#38 a table cell with a bare pipe in a code span', () => {
  const cases = [
    '| a | b |\n|---|---|\n| `x|y` | 2 |\n',
    '| a | b |\n|---|---|\n| 1 | 2 |\n| x\\|y | `p|q` |\n',
    'a | b\n--|--\n``c|d`` | e\n',
  ]
  for (const body of cases) {
    test(`loads raw and keeps every byte on edit: ${JSON.stringify(body)}`, () => {
      expect(topTypes(headless(body))).toEqual(['rawBlock'])
      expect(serializeBody(headless(body))).toBe(body)
      expectEveryEditLocal(body)
    })
  }

  test('an escaped pipe in a code span, and a pipe outside one, keep the table editable', () => {
    const body = '| a | b |\n|---|---|\n| `x\\|y` | 2 |\n| x\\|y | `p` |\n'
    expect(topTypes(headless(body))).toEqual(['table'])
    expect(editWhere(body, '2')).toBe('| a | b |\n|---|---|\n| `x\\|y` | 2Z |\n| x\\|y | `p` |\n')
    expectEveryEditLocal(body)
  })

  test('an unclosed backtick does not make a code span', () => {
    const body = '| a | b |\n|---|---|\n| `x | y |\n'
    expect(topTypes(headless(body))).toEqual(['table'])
  })
})
