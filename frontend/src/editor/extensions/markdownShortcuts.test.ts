/**
 * The Markdown shortcuts (Shortcuts panel > Markdown),
 * typed one character at a time through the editor's text-input path (the input rules), never
 * through setContent.
 */
import { Editor as TiptapEditor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { afterEach, describe, expect, test } from 'vitest'
import type { Option } from '../annotations'
import { editorExtensions, loadBody, serializeBody } from '../document'
import { BLOCK_ICON_DEFAULT } from './markdownShortcuts'

const editors: TiptapEditor[] = []
afterEach(() => {
  while (editors.length) editors.pop()!.destroy()
})

function fresh(opts?: Parameters<typeof editorExtensions>[0]): TiptapEditor {
  const editor = new TiptapEditor({ extensions: editorExtensions(opts) })
  loadBody(editor, '')
  editor.commands.setTextSelection(1)
  editors.push(editor)
  return editor
}

/** Type `text` key by key: each character goes through `handleTextInput` (input rules) or is inserted. */
function type(ed: TiptapEditor, text: string) {
  for (const ch of text) {
    const { from, to } = ed.state.selection
    const handled = ed.view.someProp('handleTextInput', (f) =>
      f(ed.view, from, to, ch, () => ed.state.tr.insertText(ch, from, to)),
    )
    if (!handled) ed.view.dispatch(ed.state.tr.insertText(ch, from, to))
  }
}

/** The node types from the doc down to the text, for the block holding `text`. */
function pathTo(ed: TiptapEditor, text: string): string[] {
  let found: string[] | null = null
  const walk = (node: PMNode, trail: string[]) => {
    if (found) return
    if (node.isTextblock && node.textContent === text) {
      found = [...trail, node.type.name === 'heading' ? `heading${node.attrs.level}` : node.type.name]
      return
    }
    node.forEach((child) => walk(child, node.type.name === 'doc' ? [] : [...trail, node.type.name]))
  }
  walk(ed.state.doc, [])
  return found ?? []
}

function optionsOf(ed: TiptapEditor, typeName: string): string[] {
  const out: string[] = []
  ed.state.doc.descendants((node) => {
    if (node.type.name !== typeName) return
    for (const o of (node.attrs.blockOptions as Option[] | null) ?? []) out.push(o.value === true ? o.key : `${o.key}=${o.value}`)
  })
  return out
}

describe('single Markdown shortcuts at the start of a block', () => {
  test('"| " makes a quote', () => {
    const ed = fresh()
    type(ed, '| Said')
    expect(pathTo(ed, 'Said')).toEqual(['blockquote', 'paragraph'])
    expect(serializeBody(ed)).toBe('> Said')
  })

  test('"> " makes a toggle, not a quote', () => {
    const ed = fresh()
    type(ed, '> Head')
    expect(pathTo(ed, 'Head')).toEqual(['toggle', 'paragraph'])
  })

  test('"a) " makes an alphabetical list and "i) " a roman one', () => {
    const a = fresh()
    type(a, 'a) One')
    expect(pathTo(a, 'One')).toEqual(['orderedList', 'listItem', 'paragraph'])
    expect(optionsOf(a, 'orderedList')).toEqual(['list=alphabetical'])
    const i = fresh()
    type(i, 'i) One')
    expect(pathTo(i, 'One')).toEqual(['orderedList', 'listItem', 'paragraph'])
    expect(optionsOf(i, 'orderedList')).toEqual(['list=roman'])
  })

  test('"() " gives the block an icon', () => {
    const ed = fresh()
    type(ed, '() Note')
    expect(pathTo(ed, 'Note')).toEqual(['paragraph'])
    expect(optionsOf(ed, 'paragraph')).toEqual([`icon=${BLOCK_ICON_DEFAULT}`])
    expect(ed.state.doc.textContent).toBe('Note')
  })

  test.each([
    ['* ', ['bulletList', 'listItem', 'paragraph']],
    ['- ', ['bulletList', 'listItem', 'paragraph']],
    ['1. ', ['orderedList', 'listItem', 'paragraph']],
    ['[] ', ['taskList', 'taskItem', 'paragraph']],
    ['# ', ['heading1']],
    ['## ', ['heading2']],
    ['### ', ['heading3']],
    ['#### ', ['heading4']],
  ])('"%s" (built in) still converts', (prefix, path) => {
    const ed = fresh()
    type(ed, `${prefix}Text`)
    expect(pathTo(ed, 'Text')).toEqual(path)
  })

  test('"---" makes a horizontal line', () => {
    const ed = fresh()
    type(ed, '---')
    let hr = 0
    ed.state.doc.descendants((n) => void (n.type.name === 'horizontalRule' && hr++))
    expect(hr).toBe(1)
  })

  test('not at the start of a block, the characters stay text', () => {
    const ed = fresh()
    type(ed, 'x > a) () | ')
    expect(pathTo(ed, 'x > a) () | ')).toEqual(['paragraph'])
  })
})

describe('combined shortcuts (Space only after the last one)', () => {
  test('">#" makes a heading 1 with a toggle (the Shortcuts panel\'s example)', () => {
    const ed = fresh()
    type(ed, '># Title')
    expect(pathTo(ed, 'Title')).toEqual(['toggle', 'heading1'])
  })

  test('">|" makes a quote with a toggle', () => {
    const ed = fresh()
    type(ed, '>| Q')
    expect(pathTo(ed, 'Q')).toEqual(['toggle', 'blockquote', 'paragraph'])
  })

  test('"|a)" makes an alphabetical list in a quote', () => {
    const ed = fresh()
    type(ed, '|a) Item')
    expect(pathTo(ed, 'Item')).toEqual(['blockquote', 'orderedList', 'listItem', 'paragraph'])
    expect(optionsOf(ed, 'orderedList')).toEqual(['list=alphabetical'])
  })

  test('">[]" makes a to-do with a toggle, "##()" a heading 2 with an icon', () => {
    const t = fresh()
    type(t, '>[] Do')
    expect(pathTo(t, 'Do')).toEqual(['toggle', 'taskList', 'taskItem', 'paragraph'])
    const h = fresh()
    type(h, '##() Big')
    expect(pathTo(h, 'Big')).toEqual(['heading2'])
    expect(optionsOf(h, 'heading')).toEqual([`icon=${BLOCK_ICON_DEFAULT}`])
  })

  test('">i)" makes a roman list with a toggle; ">-" a bullet', () => {
    const r = fresh()
    type(r, '>i) R')
    expect(pathTo(r, 'R')).toEqual(['toggle', 'orderedList', 'listItem', 'paragraph'])
    expect(optionsOf(r, 'orderedList')).toEqual(['list=roman'])
    const b = fresh()
    type(b, '>- B')
    expect(pathTo(b, 'B')).toEqual(['toggle', 'bulletList', 'listItem', 'paragraph'])
  })

  test('the caret stays in the converted block, ready to type', () => {
    const ed = fresh()
    type(ed, '>#')
    type(ed, ' ')
    expect(ed.state.selection.$from.parent.type.name).toBe('heading')
    expect(ed.state.selection.$from.parentOffset).toBe(0)
  })

  test('with numbered-list detection off, "1." does not combine either', () => {
    const ed = fresh({ numberedListInputRule: false })
    type(ed, '>1. x')
    expect(pathTo(ed, '>1. x')).toEqual(['paragraph'])
  })

  test('"|()" makes a quote without an icon (a quoted paragraph cannot save one)', () => {
    const ed = fresh()
    type(ed, '|() Q')
    expect(pathTo(ed, 'Q')).toEqual(['blockquote', 'paragraph'])
    expect(optionsOf(ed, 'paragraph')).toEqual([])
    expect(ed.state.doc.textContent).toBe('Q')
  })

  /** Every block option and list-item option in the doc, by node type. */
  function allOptions(ed: TiptapEditor): string[] {
    const out: string[] = []
    ed.state.doc.descendants((node) => {
      for (const attr of ['blockOptions', 'options']) {
        for (const o of (node.attrs[attr] as Option[] | null | undefined) ?? []) {
          out.push(`${node.type.name}:${o.key}=${String(o.value)}`)
        }
      }
    })
    return out.sort()
  }

  test.each(['() ', '|() ', '>() ', '-() ', '[]() ', 'a)() ', '#() ', '##() ', '>#() ', '|-() ', '>|() ', '>[]() ', '|#() '])(
    '"%s" shows only what saves: the typed block round-trips through the Markdown',
    (prefix) => {
      const ed = fresh()
      type(ed, `${prefix}Text`)
      const reloaded = fresh()
      loadBody(reloaded, serializeBody(ed))
      expect(allOptions(reloaded)).toEqual(allOptions(ed))
      expect(pathTo(reloaded, 'Text')).toEqual(pathTo(ed, 'Text'))
    },
  )

  test('a toggle typed this way saves as a toggle container', () => {
    const ed = fresh()
    type(ed, '># Title')
    expect(serializeBody(ed)).toMatch(/^<!-- toggle open -->\n# Title\n<!-- \/toggle -->/)
  })
})

// M32 item 4, "Markdown habits": the GitHub way of writing a to-do.
describe('"- [ ] " and "- [x] " make a to-do (M32)', () => {
  const checkedOf = (ed: TiptapEditor): boolean[] => {
    const out: boolean[] = []
    ed.state.doc.descendants((n) => {
      if (n.type.name === 'taskItem') out.push(!!n.attrs.checked)
    })
    return out
  }

  test('test "- [ ] " makes an unchecked to-do', () => {
    const ed = fresh()
    type(ed, '- [ ] Buy milk')
    expect(pathTo(ed, 'Buy milk')).toEqual(['taskList', 'taskItem', 'paragraph'])
    expect(checkedOf(ed)).toEqual([false])
    expect(serializeBody(ed)).toBe('- [ ] Buy milk')
  })

  test('test "- [x] " makes a checked to-do, "[X]" too', () => {
    const ed = fresh()
    type(ed, '- [x] Paid the bill')
    expect(pathTo(ed, 'Paid the bill')).toEqual(['taskList', 'taskItem', 'paragraph'])
    expect(checkedOf(ed)).toEqual([true])
    expect(serializeBody(ed)).toBe('- [x] Paid the bill')
    const upper = fresh()
    type(upper, '- [X] Done')
    expect(checkedOf(upper)).toEqual([true])
  })

  test('test "* [ ] " makes a to-do', () => {
    const ed = fresh()
    type(ed, '* [ ] Call back')
    expect(pathTo(ed, 'Call back')).toEqual(['taskList', 'taskItem', 'paragraph'])
    expect(checkedOf(ed)).toEqual([false])
  })

  test('test "[] " keeps working, and "[ ] " / "[x] " work at the start of a text line', () => {
    const old = fresh()
    type(old, '[] Old way')
    expect(pathTo(old, 'Old way')).toEqual(['taskList', 'taskItem', 'paragraph'])
    expect(checkedOf(old)).toEqual([false])
    const open = fresh()
    type(open, '[ ] Open')
    expect(pathTo(open, 'Open')).toEqual(['taskList', 'taskItem', 'paragraph'])
    expect(checkedOf(open)).toEqual([false])
    const done = fresh()
    type(done, '[x] Done')
    expect(pathTo(done, 'Done')).toEqual(['taskList', 'taskItem', 'paragraph'])
    expect(checkedOf(done)).toEqual([true])
    expect(serializeBody(done)).toBe('- [x] Done')
  })

  test('test the caret stays in the new to-do, ready to type', () => {
    const ed = fresh()
    type(ed, '- [ ] ')
    expect(ed.state.selection.$from.parent.type.name).toBe('paragraph')
    expect(ed.state.selection.$from.node(-1).type.name).toBe('taskItem')
    expect(ed.state.doc.textContent).toBe('')
  })

  test('test in a bullet list with other lines only the typed line becomes a to-do', () => {
    const ed = fresh()
    type(ed, '- first')
    ed.commands.splitListItem('listItem')
    type(ed, '[ ] second')
    expect(pathTo(ed, 'first')).toEqual(['bulletList', 'listItem', 'paragraph'])
    expect(pathTo(ed, 'second')).toEqual(['bulletList', 'taskItem', 'paragraph'])
    expect(checkedOf(ed)).toEqual([false])
    expect(serializeBody(ed).trimEnd()).toBe('- first\n- [ ] second')
    // The mixed list loads back as it was written.
    const reloaded = fresh()
    loadBody(reloaded, '- first\n- [ ] second\n')
    expect(pathTo(reloaded, 'first')).toEqual(['bulletList', 'listItem', 'paragraph'])
    expect(pathTo(reloaded, 'second')).toEqual(['bulletList', 'taskItem', 'paragraph'])
    expect(serializeBody(reloaded)).toBe('- first\n- [ ] second\n')
  })

  test('test "[x] " typed before the text of a saved bullet line rewrites only that line', () => {
    const ed = fresh()
    loadBody(ed, 'Intro\n\n* one\n* two\n* three\n\nOutro\n')
    let at = -1
    ed.state.doc.descendants((n, pos) => {
      if (n.isTextblock && n.textContent === 'two') at = pos + 1
    })
    ed.commands.setTextSelection(at)
    type(ed, '[x] ')
    expect(pathTo(ed, 'two')).toEqual(['bulletList', 'taskItem', 'paragraph'])
    expect(checkedOf(ed)).toEqual([true])
    const out = serializeBody(ed)
    expect(out.split('\n').filter((l) => l.includes('two'))).toEqual([expect.stringMatching(/^[*-] \[x\] two$/)])
    expect(out.startsWith('Intro\n\n')).toBe(true)
    expect(out.endsWith('\n\nOutro\n')).toBe(true)
    // What was written loads back the same.
    const reloaded = fresh()
    loadBody(reloaded, out)
    expect(pathTo(reloaded, 'two')).toEqual(['bulletList', 'taskItem', 'paragraph'])
    expect(serializeBody(reloaded)).toBe(out)
  })

  test('test "[ ] " stays text in a numbered list, in a heading and away from the start of a line', () => {
    const numbered = fresh()
    type(numbered, '1. [ ] x')
    expect(pathTo(numbered, '[ ] x')).toEqual(['orderedList', 'listItem', 'paragraph'])
    const heading = fresh()
    type(heading, '# [ ] x')
    expect(pathTo(heading, '[ ] x')).toEqual(['heading1'])
    const mid = fresh()
    type(mid, 'see [ ] x')
    expect(pathTo(mid, 'see [ ] x')).toEqual(['paragraph'])
    const inTodo = fresh()
    type(inTodo, '- [ ] [x] y')
    expect(pathTo(inTodo, '[x] y')).toEqual(['taskList', 'taskItem', 'paragraph'])
  })
})
