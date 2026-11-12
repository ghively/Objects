/**
 * The Markdown shortcuts (Shortcuts panel > Markdown),
 * typed one character at a time through the editor's text-input path (the input rules), never
 * through setContent.
 */
import { Editor as TiptapEditor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { afterEach, describe, expect, test } from 'vitest'
import { settingsDefaults, useSettings } from '@/settings/useSettings'
import type { Option } from '../annotations'
import { editorExtensions, loadBody, serializeBody } from '../document'
import { BLOCK_ICON_DEFAULT, parseMarks } from './markdownShortcuts'

const editors: TiptapEditor[] = []
afterEach(() => {
  while (editors.length) editors.pop()!.destroy()
  useSettings.setState({ settings: settingsDefaults })
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

// M33 (choice 7): Settings > Editor > 'Typing "> " makes': "A toggle" (default) or "A quote".
describe('the "> " setting (M33)', () => {
  const greaterThan = (v: 'toggle' | 'quote') => useSettings.setState({ settings: { ...settingsDefaults, greaterThanMakes: v } })

  test('test with "A toggle" (the default) "> " makes a toggle, exactly as before', () => {
    expect(settingsDefaults.greaterThanMakes).toBe('toggle')
    const ed = fresh()
    type(ed, '> Head')
    expect(pathTo(ed, 'Head')).toEqual(['toggle', 'paragraph'])
    expect(serializeBody(ed)).toBe('<!-- toggle open -->\nHead\n<!-- /toggle -->')
    const combined = fresh()
    type(combined, '># Title')
    expect(pathTo(combined, 'Title')).toEqual(['toggle', 'heading1'])
  })

  test('test with "A quote" "> " makes the quote block "| " makes', () => {
    greaterThan('quote')
    const ed = fresh()
    type(ed, '> Said')
    expect(pathTo(ed, 'Said')).toEqual(['blockquote', 'paragraph'])
    expect(serializeBody(ed)).toBe('> Said')
    const bar = fresh()
    type(bar, '| Said')
    expect(ed.state.doc.toJSON()).toEqual(bar.state.doc.toJSON())
    // The caret is in the quote, ready to type.
    expect(ed.state.selection.$from.parent.textContent).toBe('Said')
  })

  test('test "| " makes a quote with either setting', () => {
    for (const v of ['toggle', 'quote'] as const) {
      greaterThan(v)
      const ed = fresh()
      type(ed, '| Said')
      expect(pathTo(ed, 'Said')).toEqual(['blockquote', 'paragraph'])
      expect(serializeBody(ed)).toBe('> Said')
    }
  })

  test('test the setting is read when the key is typed: changing it needs no new editor', () => {
    const ed = fresh()
    type(ed, '> One')
    expect(pathTo(ed, 'One')).toEqual(['toggle', 'paragraph'])
    greaterThan('quote')
    // A new empty line after the toggle, in the same editor.
    const end = ed.state.doc.content.size
    ed.commands.insertContentAt(end, { type: 'paragraph' })
    ed.commands.setTextSelection(ed.state.doc.content.size - 1)
    type(ed, '> Two')
    expect(pathTo(ed, 'Two')).toEqual(['blockquote', 'paragraph'])
    expect(pathTo(ed, 'One')).toEqual(['toggle', 'paragraph'])
    greaterThan('toggle')
    ed.commands.insertContentAt(ed.state.doc.content.size, { type: 'paragraph' })
    ed.commands.setTextSelection(ed.state.doc.content.size - 1)
    type(ed, '> Three')
    expect(pathTo(ed, 'Three')).toEqual(['toggle', 'paragraph'])
  })

  test('test with "A quote" the ">" mark is the quote mark in a combined run too', () => {
    greaterThan('quote')
    const heading = fresh()
    type(heading, '># Title')
    expect(pathTo(heading, 'Title')).toEqual(['blockquote', 'heading1'])
    expect(serializeBody(heading)).toBe('> # Title')
    const list = fresh()
    type(list, '>a) One')
    expect(pathTo(list, 'One')).toEqual(['blockquote', 'orderedList', 'listItem', 'paragraph'])
    // Two quote marks are two marks of one kind: not a shortcut, the characters stay text.
    const twice = fresh()
    type(twice, '>| x')
    expect(pathTo(twice, '>| x')).toEqual(['paragraph'])
    expect(parseMarks('>|', true, 'quote')).toBeNull()
    expect(parseMarks('>', true, 'quote')).toEqual({ quote: true, count: 1 })
    expect(parseMarks('>', true, 'toggle')).toEqual({ toggle: true, count: 1 })
    expect(parseMarks('>')).toEqual({ toggle: true, count: 1 })
  })

  test('test "> " stays text in a code block and away from the start of a line, with either setting', () => {
    for (const v of ['toggle', 'quote'] as const) {
      greaterThan(v)
      const code = fresh()
      loadBody(code, '```\n\n```')
      code.commands.setTextSelection(1)
      expect(code.state.selection.$from.parent.type.name).toBe('codeBlock')
      const kinds = (ed: TiptapEditor) => {
        const out: string[] = []
        ed.state.doc.forEach((n) => out.push(n.type.name))
        return out
      }
      const before = kinds(code)
      type(code, '> x')
      expect(code.state.doc.firstChild?.type.name).toBe('codeBlock')
      expect(code.state.doc.firstChild?.textContent).toBe('> x')
      expect(kinds(code)).toEqual(before)
      const mid = fresh()
      type(mid, 'a > b')
      expect(pathTo(mid, 'a > b')).toEqual(['paragraph'])
    }
  })

  test('test one undo gives the typed characters back, as for the toggle', () => {
    const text = (ed: TiptapEditor) => ({ types: pathTo(ed, ed.state.doc.textContent), text: ed.state.doc.textContent })
    greaterThan('toggle')
    const toggle = fresh()
    type(toggle, '> ')
    expect(toggle.state.doc.firstChild?.type.name).toBe('toggle')
    toggle.commands.undo()
    greaterThan('quote')
    const quote = fresh()
    type(quote, '> ')
    expect(quote.state.doc.firstChild?.type.name).toBe('blockquote')
    quote.commands.undo()
    // The block is a plain text line again holding what was typed, the same as after the toggle's undo.
    expect(text(quote)).toEqual(text(toggle))
    expect(quote.state.doc.firstChild?.type.name).toBe('paragraph')
    expect(quote.state.doc.textContent).toBe('> ')
    expect(quote.state.doc.childCount).toBe(1)
  })

  test('test a note with a quote and a toggle round-trips byte for byte with either setting', () => {
    const body = [
      'Before',
      '',
      '> A quote',
      '> on two lines',
      '',
      '<!-- toggle open -->',
      'Head',
      '',
      'Inside',
      '<!-- /toggle -->',
      '',
      '<!-- toggle -->',
      '> A quote in a closed toggle',
      '<!-- /toggle -->',
      '',
      'After',
      '',
    ].join('\n')
    for (const eol of ['\n', '\r\n']) {
      const source = body.replace(/\n/g, eol)
      for (const v of ['toggle', 'quote'] as const) {
        greaterThan(v)
        const ed = fresh()
        loadBody(ed, source)
        expect(serializeBody(ed)).toBe(source)
      }
    }
  })
})
