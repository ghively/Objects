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

  test('an edited sibling item keeps its own indent, so the next item does not nest in it', () => {
    // GFM: four sibling items (` - b` and `  - c` sit short of the previous item's text).
    const body = '- a\n - b\n  - c\n   - d\n    - e\n'
    expect(topTypes(headless(body))).toEqual(['bulletList'])
    expect(editWhere(body, 'b')).toBe('- a\n - bZ\n  - c\n   - d\n    - e\n')
    expect(editWhere(body, 'c')).toBe('- a\n - b\n  - cZ\n   - d\n    - e\n')
    // `    - e` is text of item d (GFM: "d - e"); typed at, its line takes the escaped form.
    const saved = editWhere(body, 'd')
    expect(saved).toBe('- a\n - b\n  - c\n   - d\n    \\- eZ\n')
    expect(html(saved.replace('Z', ''))).toBe(html(body))
  })

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
  // The editor has no ordered to-do: it would show `[ ] a` as text and save it
  // escaped (`1. \[ \] aZ`), which drops the box for every other reader. Such a
  // list loads raw (fix-pass L2), so an edit never rewrites a file's to-dos as text.
  const body = '1. [ ] a\n2. [x] b\n'

  test('keeps its boxes when the list is edited: the list loads raw', () => {
    expect(topTypes(headless(body))).toEqual(['rawBlock'])
    expect(serializeBody(headless(body))).toBe(body)
    expectEveryEditLocal(body)
    const around = 'para\n\n1. [ ] a\n2. [X] b\n'
    expect(editAt(around, 0)).toBe('paraZ\n\n1. [ ] a\n2. [X] b\n')
  })

  test('a box in a nested ordered list loads the whole list raw', () => {
    for (const nested of ['- a\n  1. [ ] b\n', '1. a\n   1. [x] b\n']) {
      expect(topTypes(headless(nested))).toEqual(['rawBlock'])
      expectEveryEditLocal(nested)
    }
  })

  test('an escaped box (as the editor saves it) is text: the list stays editable', () => {
    const escaped = '1. \\[ \\] a\n2. b\n'
    expect(topTypes(headless(escaped))).toEqual(['orderedList'])
    expect(editAt(escaped, 0)).toBe('1. \\[ \\] aZ\n2. b\n')
    expectEveryEditLocal(escaped)
  })

  test('`[ ] x` typed at the start of an ordered item stays text', () => {
    const editor = headless('1. a\n2. b\n')
    const tb = textblocks(editor)[0]
    editor.view.dispatch(editor.state.tr.insertText('[ ] x', tb.pos + 1, tb.pos + tb.node.nodeSize - 1))
    const saved = serializeBody(editor)
    expect(saved).toBe('1. \\[ \\] x\n2. b\n')
    const back = headless(saved)
    expect(topTypes(back)).toEqual(['orderedList'])
    expect(textblocks(back)[0].node.textContent).toBe('[ ] x')
  })

  test('a bullet item typed as `[ ] a` text stays text', () => {
    const editor = headless('- x\n')
    const tb = textblocks(editor)[0]
    editor.view.dispatch(editor.state.tr.insertText('[ ] a', tb.pos + 1, tb.pos + tb.node.nodeSize - 1))
    expect(serializeBody(editor)).toBe('- \\[ \\] a\n')
  })
})

describe('fix-pass P1: a nested list with its own delimiter or bullet', () => {
  for (const body of ['1) a\n   1. b\n   2. c\n2) d\n', '- a\n  * b\n  * c\n- d\n', '1. a\n   - b\n   - c\n2. d\n   + e\n']) {
    test(`an edit keeps each depth's markers: ${JSON.stringify(body)}`, () => {
      expect(topTypes(headless(body))).not.toContain('rawBlock')
      expectEveryEditLocal(body)
    })
  }

  test('editing the inner item keeps the inner delimiter (the repro)', () => {
    expect(editWhere('1) a\n   1. b\n   2. c\n2) d\n', 'b')).toBe('1) a\n   1. bZ\n   2. c\n2) d\n')
  })
})

describe('fix-pass P2: two blank lines inside a list', () => {
  test('stay two on an edit anywhere in the list (the repro)', () => {
    expectEveryEditLocal('1. a0\n   1. b1\n\n   2. c3\n\n\n2. d8\n')
  })

  // The editor reads the extra blank line of a bullet item as an empty paragraph (typing there
  // adds text to the item); an edit of the item's text keeps both blank lines as they were.
  for (const body of ['- a\n\n\n- b\n\n- c\n', '- a\n\n\n\n  para\n- b\n']) {
    test(`stay as many when an item's text is edited: ${JSON.stringify(body)}`, () => {
      for (const word of ['a', 'b', 'c', 'para'].filter((w) => body.includes(`${w}\n`))) {
        expect(editWhere(body, word)).toBe(body.replace(`${word}\n`, `${word}Z\n`))
      }
    })
  }
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

  // Fix-pass L5: a definition inside a quote or a list item defines the label for the whole note.
  for (const def of ['> [foo]: /x', '>[foo]: /x', '> > [foo]: /x', '- [foo]: /x', '> - [foo]: /x', '- > [foo]: /x', '10. a\n\n    [foo]: /x']) {
    test(`a label defined in a quote or a list item keeps its brackets: ${JSON.stringify(def)}`, () => {
      const body = `${def}\n\nsee [foo]\n`
      expect(editWhere(body, 'see')).toBe(`${def}\n\nsee [foo]Z\n`)
      expect(html(body)).toContain('<a href="/x">foo</a>')
    })
  }

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

describe('sweep 2026-11-08 #1: a wikilink with a heading or block anchor keeps its `#`', () => {
  test('one typed character leaves `[[Page#Heading]]` and `[[Page#^id|label]]` as they were', () => {
    const body = 'See [[Page#Heading]] and [[Page#^abc123|q]] here\n'
    expect(serializeBody(headless(body))).toBe(body)
    expectEveryEditLocal(body)
    expect(editAt(body, 0)).toBe('See [[Page#Heading]] and [[Page#^abc123|q]] hereZ\n')
  })
})
