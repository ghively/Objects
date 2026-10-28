/**
 * M8 data layer: every new syntax round-trips byte for byte, and an edit
 * touches only its own block (plan "Review Focus" 1).
 */
import { Editor as TiptapEditor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import { afterEach, describe, expect, test } from 'vitest'
import type { Option } from './annotations'
import { editorExtensions, loadBody, serializeBody } from './document'
import { ensureBlockId, setEditorObject } from './nodes/blockRef'

const fixtures = import.meta.glob('./__fixtures__/m8/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const BLOCKS = fixtures['./__fixtures__/m8/Pages-Blocks-M8.md']
const SOURCE = fixtures['./__fixtures__/m8/Pages-Source-note.md']
const CRLF = fixtures['./__fixtures__/m8/Pages-CRLF-M8.md']
const MALFORMED = fixtures['./__fixtures__/m8/Pages-Malformed-M8.md']

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

type Found = { node: PMNode; pos: number }

function all(editor: TiptapEditor, type: string): Found[] {
  const out: Found[] = []
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === type) out.push({ node, pos })
  })
  return out
}

function blockWith(editor: TiptapEditor, text: string): Found {
  let found: Found | null = null
  editor.state.doc.descendants((node, pos) => {
    if (found) return false
    if (node.isTextblock && node.textContent.includes(text)) {
      found = { node, pos }
      return false
    }
    return true
  })
  if (!found) throw new Error(`no block with ${text}`)
  return found
}

function cursorIn(editor: TiptapEditor, text: string, atStart = false): Found {
  const b = blockWith(editor, text)
  const pos = atStart ? b.pos + 1 : b.pos + b.node.nodeSize - 1
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)))
  return b
}

/** Select `text` inside the text block that holds it. */
function select(editor: TiptapEditor, text: string, inBlock = text): void {
  const b = blockWith(editor, inBlock)
  let from = -1
  b.node.descendants((child, offset) => {
    if (from >= 0 || !child.isText) return
    const i = child.text!.indexOf(text)
    if (i >= 0) from = b.pos + 1 + offset + i
  })
  if (from < 0) throw new Error(`${text} spans nodes`)
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, from + text.length)))
}

function typeAtEndOf(editor: TiptapEditor, text: string, insert: string): void {
  const b = blockWith(editor, text)
  editor.commands.insertContentAt(b.pos + b.node.nodeSize - 1, insert)
}

/** The lines of `b` that differ from `a`, when both have the same number of lines. */
function lineDiff(a: string, b: string): { index: number; before: string; after: string }[] {
  const la = a.split('\n')
  const lb = b.split('\n')
  expect(lb.length).toBe(la.length)
  return la.flatMap((line, i) => (line === lb[i] ? [] : [{ index: i, before: line, after: lb[i] }]))
}

describe('m8 round trip', () => {
  test('every m8 fixture body round trips byte for byte', () => {
    const names = Object.keys(fixtures)
    expect(names.length).toBeGreaterThanOrEqual(4)
    for (const name of names) {
      const editor = headless(fixtures[name])
      expect(serializeBody(editor), name).toBe(fixtures[name])
    }
    // Every new node loaded as itself (not as a raw block).
    const editor = headless(BLOCKS)
    for (const type of ['indent', 'blockRef', 'dataViewEmbed', 'dateToken', 'listItemOptions']) {
      expect(all(editor, type).length, type).toBeGreaterThan(0)
    }
    expect(all(editor, 'rawBlock')).toEqual([])
    let marks = 0
    editor.state.doc.descendants((n) => {
      marks += n.marks.filter((m) => m.type.name === 'textColor' || m.type.name === 'highlight').length
    })
    expect(marks).toBeGreaterThanOrEqual(3)
  })

  test('adding a block id changes only that line', () => {
    const editor = headless(BLOCKS)
    setEditorObject(editor, { path: 'Pages/Blocks M8.md', title: 'Blocks M8' })
    cursorIn(editor, 'Some ')
    const id = ensureBlockId(editor, () => 0.5)
    expect(id).toMatch(/^[a-z0-9]{6}$/)
    const out = serializeBody(editor)
    expect(lineDiff(BLOCKS, out)).toEqual([
      {
        index: 2,
        before: BLOCKS.split('\n')[2],
        after: `${BLOCKS.split('\n')[2]} ^${id}`,
      },
    ])

    // A block that already has an id keeps it (no write).
    cursorIn(editor, 'A paragraph that others reference.')
    expect(ensureBlockId(editor)).toBe('ab12cd')
    expect(serializeBody(editor)).toBe(out)

    // A list item: the id ends the item's first line, after its item comment.
    cursorIn(editor, 'Buy milk')
    const itemId = ensureBlockId(editor, () => 0.1)!
    expect(serializeBody(editor).split('\n')).toContain(`- Buy milk <!-- item: color=text-blue --> ^${itemId}`)
    expect(lineDiff(out, serializeBody(editor)).map((d) => d.index)).toEqual([16])

    // Ids never collide with one already in the body.
    cursorIn(editor, 'Call Ada')
    const third = ensureBlockId(editor, () => 0.1)!
    expect(new Set([id, itemId, third, 'ab12cd', 'qr34st']).size).toBe(5)
  })

  test('inline colour edit rewrites only its block', () => {
    const editor = headless(BLOCKS)
    select(editor, 'Some')
    expect(editor.commands.setTextColor('green')).toBe(true)
    const out = serializeBody(editor)
    expect(lineDiff(BLOCKS, out)).toEqual([
      {
        index: 2,
        before: 'Some <span data-color="text-red">red words</span> and a <mark data-color="bg-yellow">yellow highlight</mark>.',
        after:
          '<span data-color="text-green">Some</span> <span data-color="text-red">red words</span> and a <mark data-color="bg-yellow">yellow highlight</mark>.',
      },
    ])

    // Highlight and removal: `text-` and `bg-` forms are accepted; null removes.
    select(editor, 'red words')
    editor.commands.setTextColor(null)
    select(editor, 'yellow highlight')
    editor.commands.setHighlight('bg-blue')
    expect(serializeBody(editor).split('\n')[2]).toBe(
      '<span data-color="text-green">Some</span> red words and a <mark data-color="bg-blue">yellow highlight</mark>.',
    )
    // An unknown colour is refused.
    expect(editor.commands.setHighlight('nope')).toBe(false)
  })

  test('malformed spans and marks stay raw', () => {
    const editor = headless(MALFORMED)
    const raws = all(editor, 'rawBlock').map((r) => r.node.textContent)
    expect(raws).toEqual(
      expect.arrayContaining([
        'An <span data-color="text-red">unclosed span.',
        'A <mark data-color="bg-nope">bad colour</mark> mark.',
        'A <span data-color="text-red">nested <span data-color="text-blue">span</span></span> here.',
        '<time datetime="tomorrow">tomorrow</time>',
      ]),
    )
    // A too-long id is plain text; `![[collection:]]` is an ordinary embed; a stray close line is plain.
    expect(blockWith(editor, 'too long').node.type.name).toBe('paragraph')
    expect(all(editor, 'dataViewEmbed')).toEqual([])
    expect(all(editor, 'indent')).toEqual([])
    // An edit elsewhere keeps every malformed byte.
    typeAtEndOf(editor, 'too long', '!')
    expect(serializeBody(editor)).toBe(MALFORMED.replace('^TOOLONG1', '^TOOLONG1!'))
  })

  test('bare mark loads as yellow and is kept as written', () => {
    const editor = headless(BLOCKS)
    const b = blockWith(editor, 'A bare highlight')
    const marks: { color: string; bare: boolean }[] = []
    b.node.descendants((n) => {
      for (const m of n.marks) if (m.type.name === 'highlight') marks.push(m.attrs as { color: string; bare: boolean })
    })
    expect(marks).toEqual([{ color: 'yellow', bare: true }])
    typeAtEndOf(editor, 'A bare highlight', ' Really.')
    expect(serializeBody(editor)).toBe(
      BLOCKS.replace('A bare <mark>highlight</mark> stays bare.', 'A bare <mark>highlight</mark> stays bare. Really.'),
    )
    // Setting a colour writes the attribute.
    select(editor, 'highlight', 'A bare highlight')
    editor.commands.setHighlight('red')
    expect(serializeBody(editor)).toContain('A bare <mark data-color="bg-red">highlight</mark> stays bare. Really.')
  })

  test('date token loads and saves', () => {
    const editor = headless('Today is <time datetime="2026-10-27">Tuesday</time>.\n\nNext\n')
    const [token] = all(editor, 'dateToken')
    expect(token.node.attrs).toMatchObject({ date: '2026-10-27', text: 'Tuesday' })
    expect(token.node.textContent).toBe('')
    // An edit in the block keeps the token's own text.
    typeAtEndOf(editor, 'Today is', ' Yes.')
    expect(serializeBody(editor)).toBe('Today is <time datetime="2026-10-27">Tuesday</time>. Yes.\n\nNext\n')
    // A new token writes the ISO day as its text.
    cursorIn(editor, 'Next')
    expect(editor.commands.insertDateToken('2026-10-28')).toBe(true)
    expect(serializeBody(editor)).toBe(
      'Today is <time datetime="2026-10-27">Tuesday</time>. Yes.\n\nNext<time datetime="2026-10-28">2026-10-28</time>\n',
    )
    expect(editor.commands.insertDateToken('tomorrow')).toBe(false)
  })

  test('indent container groups and ungroups without touching children', () => {
    const body = 'Intro\n\nParent\n\nChild one\n\nChild two\n\nAfter\n'
    const editor = headless(body)
    cursorIn(editor, 'Child one')
    expect(editor.commands.indentBlock()).toBe(true)
    const once = '<!-- indent -->\nParent\n\nChild one\n<!-- /indent -->\n\nChild two\n\nAfter\n'
    expect(serializeBody(editor)).toBe('Intro\n\n' + once)
    cursorIn(editor, 'Child two')
    expect(editor.commands.indentBlock()).toBe(true)
    expect(serializeBody(editor)).toBe('Intro\n\n<!-- indent -->\nParent\n\nChild one\n\nChild two\n<!-- /indent -->\n\nAfter\n')
    // The parent line cannot be indented under itself; the first block has nothing above it.
    cursorIn(editor, 'Intro')
    expect(editor.commands.unindentBlock()).toBe(false)
    // Out again, in reverse: the original bytes.
    cursorIn(editor, 'Child two')
    expect(editor.commands.unindentBlock()).toBe(true)
    expect(serializeBody(editor)).toBe('Intro\n\n' + once)
    cursorIn(editor, 'Child one')
    expect(editor.commands.unindentBlock()).toBe(true)
    expect(serializeBody(editor)).toBe(body)

    // An existing container: unindenting its middle child keeps every child's bytes, and the
    // children after it become its own.
    const ed2 = headless(BLOCKS)
    cursorIn(ed2, 'An indented child')
    expect(ed2.commands.unindentBlock()).toBe(true)
    const out = serializeBody(ed2)
    expect(out).toContain('The parent line\n\n<!-- indent -->\nAn indented child\n\nAnother child\n<!-- /indent -->\n\n- Buy milk')
    expect(out.startsWith(BLOCKS.slice(0, BLOCKS.indexOf('<!-- indent -->')))).toBe(true)
    expect(out.endsWith(BLOCKS.slice(BLOCKS.indexOf('- Buy milk')))).toBe(true)
    // Undo restores the original bytes.
    ed2.commands.undo()
    expect(serializeBody(ed2)).toBe(BLOCKS)
  })

  test('item comment survives list edits elsewhere', () => {
    const editor = headless(BLOCKS)
    typeAtEndOf(editor, 'Call Ada', ' today')
    let out = serializeBody(editor)
    expect(lineDiff(BLOCKS, out)).toEqual([{ index: 17, before: '- Call Ada', after: '- Call Ada today' }])

    // Options on the item at the cursor: insert, change (canonical, before the id), remove.
    cursorIn(editor, 'Call Ada')
    editor.commands.setListItemOptions({ color: 'text-green' })
    out = serializeBody(editor)
    expect(out.split('\n')[17]).toBe('- Call Ada today <!-- item: color=text-green -->')
    cursorIn(editor, 'Read the paper', true)
    editor.commands.setListItemOptions({ color: 'bg-gray' })
    expect(serializeBody(editor).split('\n')[18]).toBe('- Read the paper <!-- item: small color=bg-gray --> ^qr34st')
    editor.commands.setListItemOptions({ color: null, small: null })
    expect(serializeBody(editor).split('\n')[18]).toBe('- Read the paper ^qr34st')
    cursorIn(editor, 'Buy milk')
    editor.commands.setListItemOptions({ color: null })
    expect(serializeBody(editor).split('\n')[16]).toBe('- Buy milk')
    // Outside a list it does nothing.
    cursorIn(editor, 'The parent line')
    expect(editor.commands.setListItemOptions({ small: true })).toBe(false)
  })

  test('block reference line becomes a block ref node', () => {
    const editor = headless(BLOCKS)
    const [ref] = all(editor, 'blockRef')
    expect(ref.node.attrs).toMatchObject({ target: 'Source note', id: 'ab12cd', label: null })
    const ed2 = headless('![[Source note#^zz9zz9|the item]]\n\nText\n')
    expect(all(ed2, 'blockRef')[0].node.attrs).toMatchObject({ target: 'Source note', id: 'zz9zz9', label: 'the item' })
    expect(serializeBody(ed2)).toBe('![[Source note#^zz9zz9|the item]]\n\nText\n')
    cursorIn(ed2, 'Text')
    ed2.commands.insertBlockRef('Blocks M8', 'ab12cd')
    expect(serializeBody(ed2)).toBe('![[Source note#^zz9zz9|the item]]\n\nText\n\n![[Blocks M8#^ab12cd]]\n')
    // Ids inside the source load as text and stay.
    const src = headless(SOURCE)
    expect(blockWith(src, 'Second item').node.textContent).toBe('Second item ^zz9zz9')
    expect(serializeBody(src)).toBe(SOURCE)
  })

  test('dataview embed lines', () => {
    const editor = headless(BLOCKS)
    const embeds = all(editor, 'dataViewEmbed').map((e) => e.node.attrs)
    expect(embeds).toEqual([
      expect.objectContaining({ kind: 'collection', id: 'reading-list', blockOptions: null }),
      expect.objectContaining({
        kind: 'query',
        id: 'open-tasks',
        blockOptions: [{ key: 'details', value: true, raw: 'details' }] satisfies Option[],
      }),
    ])
    // "Show details" is the `details` option.
    const first = all(editor, 'dataViewEmbed')[0]
    editor.commands.setBlockOption('details', true, first.pos)
    expect(serializeBody(editor)).toContain('<!-- block: details -->\n![[collection:reading-list]]\n\n<!-- block: details -->\n![[query:open-tasks]]')
    const second = all(editor, 'dataViewEmbed')[1]
    editor.commands.setBlockOption('details', null, second.pos)
    expect(serializeBody(editor)).toContain('<!-- block: details -->\n![[collection:reading-list]]\n\n![[query:open-tasks]]\n')
    // Insert.
    const ed2 = headless('Text\n')
    cursorIn(ed2, 'Text')
    expect(ed2.commands.insertDataViewEmbed('query', 'q1')).toBe(true)
    expect(serializeBody(ed2)).toBe('Text\n\n![[query:q1]]\n')
  })

  test('CRLF body keeps CRLF on new syntax', () => {
    const editor = headless(CRLF)
    expect(serializeBody(editor)).toBe(CRLF)
    setEditorObject(editor, { path: 'Pages/CRLF M8.md' })
    cursorIn(editor, 'Last line.')
    const id = ensureBlockId(editor, () => 0.3)
    select(editor, 'text.')
    editor.commands.setHighlight('pink')
    cursorIn(editor, 'Child')
    editor.commands.unindentBlock()
    cursorIn(editor, 'Last line.')
    editor.commands.indentBlock()
    const out = serializeBody(editor)
    expect(out.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/)
    expect(out).toBe(
      '﻿A line with <span data-color="text-green">green</span> <mark data-color="bg-pink">text.</mark>\r\n\r\n' +
        'A referenced line. ^cr1f00\r\n\r\n' +
        'Parent\r\n\r\n' +
        `<!-- indent -->\r\nChild\r\n\r\nLast line. ^${id}\r\n<!-- /indent -->\r\n`,
    )
  })
})
