/**
 * M14 data layer: the button block (`<!-- block: button rule="<id>" -->` on a one-line
 * paragraph) round-trips byte for byte (LF, CRLF with a BOM, malformed forms, inside a
 * container), editing the label rewrites only the label line, choosing another rule only the
 * annotation line, and an insert writes the contract's exact text.
 */
import { Editor as TiptapEditor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import { afterEach, describe, expect, test } from 'vitest'
import { formatAnnotation, isKnownValue, knownOption, makeOption, parseAnnotation } from './annotations'
import { splitBlocks } from './blocks'
import { blockTargets, buildTree } from './blockTree'
import { editorExtensions, loadBody, serializeBody } from './document'
import { buttonLabelSource, buttonLabelText, buttonRuleOf } from './nodes/buttonBlock'

const fixtures = import.meta.glob('./__fixtures__/m14/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const BUTTONS = fixtures['./__fixtures__/m14/Pages-Buttons.md']
const CRLF = fixtures['./__fixtures__/m14/Pages-Buttons-CRLF.md']
const MALFORMED = fixtures['./__fixtures__/m14/Pages-Buttons-Malformed.md']

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

function buttons(editor: TiptapEditor): Found[] {
  const out: Found[] = []
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'buttonBlock') out.push({ node, pos })
  })
  return out
}

function setLabel(editor: TiptapEditor, at: Found, text: string): void {
  editor.view.dispatch(editor.state.tr.setNodeAttribute(at.pos, 'label', buttonLabelSource(text)))
}

function cursorAtEndOf(editor: TiptapEditor, text: string): void {
  let pos = -1
  editor.state.doc.descendants((node, p) => {
    if (pos < 0 && node.isTextblock && node.textContent.includes(text)) pos = p + node.nodeSize - 1
  })
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)))
}

describe('the button and rule options', () => {
  test('known options, canonical order after bookmark, rule always quoted', () => {
    expect(knownOption('button')).toMatchObject({ value: 'flag', appliesTo: ['button'] })
    expect(knownOption('rule')).toMatchObject({ appliesTo: ['button'], quoted: true })
    expect(knownOption('bookmark')!.order).toBeLessThan(knownOption('button')!.order)
    expect(knownOption('button')!.order).toBeLessThan(knownOption('rule')!.order)
    expect(isKnownValue({ key: 'rule', value: '01JC7ZK3T9Q4M2X8B5N6R1V0WE' })).toBe(true)
    expect(isKnownValue({ key: 'rule', value: '' })).toBe(true)
    expect(isKnownValue({ key: 'rule', value: 'bad value!' })).toBe(false)
    expect(formatAnnotation({ type: 'leaf', options: [makeOption('rule', 'X1'), makeOption('button', true)] })).toBe(
      '<!-- block: button rule="X1" -->',
    )
    // Both forms are read.
    expect(parseAnnotation('<!-- block: button rule=X1 -->')!.options.map((o) => [o.key, o.value])).toEqual([
      ['button', true],
      ['rule', 'X1'],
    ])
    expect(parseAnnotation('<!-- block: button rule="X1" -->')!.options[1].value).toBe('X1')
  })

  test('a one-line paragraph can be a button; two lines or a list cannot', () => {
    expect(blockTargets({ kind: 'paragraph', raw: 'Start review\n' })).toContain('button')
    expect(blockTargets({ kind: 'paragraph', raw: 'Start review' })).toContain('button')
    expect(blockTargets({ kind: 'paragraph', raw: 'Start review\r\n' })).toContain('button')
    expect(blockTargets({ kind: 'paragraph', raw: 'One\nTwo\n' })).not.toContain('button')
    expect(blockTargets({ kind: 'list', raw: '- a\n' })).not.toContain('button')
    expect(blockTargets({ kind: 'paragraph', raw: '![[Some object]]\n' })).not.toContain('button')
    const tree = buildTree(splitBlocks('<!-- block: button rule="X" -->\nOne\nTwo\n'))
    expect(tree.every((n) => n.kind === 'leaf' && !n.annotation)).toBe(true)
  })
})

describe('button block round trip', () => {
  test.each([
    ['LF fixture', BUTTONS],
    ['CRLF and BOM fixture', CRLF],
    ['malformed fixture', MALFORMED],
    ['BOM before the annotation', '﻿<!-- block: button rule="X1" -->\nLabel\n'],
    ['no final line break', 'Before\n\n<!-- block: button rule="X1" -->\nLabel'],
    ['CRLF without a final break', 'A\r\n\r\n<!-- block: button -->\r\nLabel'],
    ['lone CR', 'A\r\r<!-- block: button rule="X1" -->\rLabel\r'],
    ['bookmark and button', '<!-- block: button rule="X1" -->\n[Docs](https://example.com)\n'],
  ])('%s loads and saves byte for byte', (_name, body) => {
    const editor = headless(body)
    expect(serializeBody(editor)).toBe(body)
  })

  test('the fixture loads its buttons with labels and rules', () => {
    const editor = headless(BUTTONS)
    const found = buttons(editor).map(({ node }) => [
      buttonLabelText(node.attrs.label),
      buttonRuleOf(node.attrs.blockOptions),
    ])
    expect(found).toEqual([
      ['Start weekly review', '01JC7ZK3T9Q4M2X8B5N6R1V0WE'],
      ['Stamp it', '01JC7ZK3T9Q4M2X8B5N6R1V0WF'],
      ['No automation yet', null],
      ['Indented label with **bold**', null],
      ['Nested button', '01JC7ZK3T9Q4M2X8B5N6R1V0WG'],
    ])
  })

  test('malformed forms stay ordinary comments and text', () => {
    const editor = headless(MALFORMED)
    // The odd rule value, the embed and the spaced annotation: only the one-line labels are buttons.
    expect(buttons(editor).map(({ node }) => buttonLabelText(node.attrs.label))).toEqual(['Odd rule', 'Spaced annotation'])
    expect(buttonRuleOf(buttons(editor)[0].node.attrs.blockOptions)).toBe('bad value!')
  })
})

describe('edits touch only their own line', () => {
  test('editing the label rewrites only the label line', () => {
    const editor = headless(BUTTONS)
    setLabel(editor, buttons(editor)[0], 'Begin the review')
    expect(serializeBody(editor)).toBe(BUTTONS.replace('\nStart weekly review\n', '\nBegin the review\n'))
  })

  test('choosing another rule rewrites only the annotation line', () => {
    const editor = headless(BUTTONS)
    editor.commands.setBlockOption('rule', '01JNEWRULE000000000000000', buttons(editor)[0].pos)
    expect(serializeBody(editor)).toBe(
      BUTTONS.replace(
        '<!-- block: button rule="01JC7ZK3T9Q4M2X8B5N6R1V0WE" -->',
        '<!-- block: button rule="01JNEWRULE000000000000000" -->',
      ),
    )
  })

  test('a bare rule keeps its line while only the label changes', () => {
    const editor = headless(BUTTONS)
    setLabel(editor, buttons(editor)[1], 'Stamp')
    expect(serializeBody(editor)).toBe(BUTTONS.replace('\nStamp it  \n', '\nStamp\n'))
  })

  test('choosing a rule for a button without one writes it quoted', () => {
    const editor = headless(BUTTONS)
    editor.commands.setBlockOption('rule', 'R2', buttons(editor)[2].pos)
    expect(serializeBody(editor)).toBe(BUTTONS.replace('<!-- block: button -->', '<!-- block: button rule="R2" -->'))
  })

  test('unknown options are kept when the rule changes', () => {
    const editor = headless(BUTTONS)
    editor.commands.setBlockOption('rule', 'R3', buttons(editor)[3].pos)
    expect(serializeBody(editor)).toBe(
      BUTTONS.replace('<!-- block: button rule="" small zz-keep="yes" -->', '<!-- block: small button rule="R3" zz-keep="yes" -->'),
    )
  })

  test('a button inside a toggle edits only its line', () => {
    const editor = headless(BUTTONS)
    setLabel(editor, buttons(editor)[4], 'Nested')
    expect(serializeBody(editor)).toBe(BUTTONS.replace('\nNested button\n', '\nNested\n'))
  })

  test('CRLF and the BOM are kept on edits', () => {
    const editor = headless(CRLF)
    setLabel(editor, buttons(editor)[0], 'Go')
    expect(serializeBody(editor)).toBe(CRLF.replace('\r\nStart weekly review\r\n', '\r\nGo\r\n'))
    editor.commands.setBlockOption('rule', 'R9', buttons(editor)[0].pos)
    expect(serializeBody(editor)).toBe(
      CRLF.replace('\r\nStart weekly review\r\n', '\r\nGo\r\n').replace('rule="01JC7ZK3T9Q4M2X8B5N6R1V0WE"', 'rule="R9"'),
    )
    expect(serializeBody(editor).startsWith('﻿')).toBe(true)
  })

  test('undoing an edit gives the original bytes back', () => {
    const editor = headless(BUTTONS)
    setLabel(editor, buttons(editor)[0], 'Begin the review')
    editor.commands.undo()
    expect(serializeBody(editor)).toBe(BUTTONS)
  })
})

describe('insertButtonBlock', () => {
  test('writes the annotation, the label and the line ends as its own block', () => {
    const editor = headless('Text\n')
    cursorAtEndOf(editor, 'Text')
    expect(editor.commands.insertButtonBlock('01JC7ZK3T9Q4M2X8B5N6R1V0WE', 'Start weekly review')).toBe(true)
    expect(serializeBody(editor)).toBe('Text\n\n<!-- block: button rule="01JC7ZK3T9Q4M2X8B5N6R1V0WE" -->\nStart weekly review\n')
  })

  test('without a rule writes the bare flag and the default label', () => {
    const editor = headless('Text\n')
    cursorAtEndOf(editor, 'Text')
    editor.commands.insertButtonBlock(null)
    expect(serializeBody(editor)).toBe('Text\n\n<!-- block: button -->\nRun automation\n')
  })

  test("uses the document's line ending", () => {
    const editor = headless('Text\r\n\r\nMore\r\n')
    cursorAtEndOf(editor, 'Text')
    editor.commands.insertButtonBlock('R1', 'Go')
    expect(serializeBody(editor)).toBe('Text\r\n\r\n<!-- block: button rule="R1" -->\r\nGo\r\n\r\nMore\r\n')
  })

  test('an inserted button reads back as a button', () => {
    const editor = headless('Text\n')
    cursorAtEndOf(editor, 'Text')
    editor.commands.insertButtonBlock('R1', '# Not a heading')
    const out = serializeBody(editor)
    expect(out).toBe('Text\n\n<!-- block: button rule="R1" -->\n\\# Not a heading\n')
    const again = headless(out)
    expect(buttons(again).map(({ node }) => buttonLabelText(node.attrs.label))).toEqual(['# Not a heading'])
    expect(serializeBody(again)).toBe(out)
  })
})

describe('labels', () => {
  // Review M14 #7: a label that would read back as a thematic break or a link reference
  // definition is escaped, so the button survives a reload.
  test.each(['___', '_ _ _', '[x]: y', '[^1]: note', '* * *', '- - -', '[Open](https://example.com)'])(
    'a button labelled %j reads back as that button',
    (label) => {
      const editor = headless('Text\n')
      cursorAtEndOf(editor, 'Text')
      editor.commands.insertButtonBlock('R1', label)
      const out = serializeBody(editor)
      const again = headless(out)
      expect(buttons(again).map(({ node }) => buttonLabelText(node.attrs.label))).toEqual([label])
      expect(serializeBody(again)).toBe(out)
    },
  )

  test.each([
    ['Start review', 'Start review'],
    ['  two\nlines  ', 'two lines'],
    ['# heading', '\\# heading'],
    ['- item', '\\- item'],
    ['1. first', '\\1. first'],
    ['> quote', '\\> quote'],
    ['<!-- x -->', '\\<!-- x -->'],
    ['![[embed]]', '\\![[embed]]'],
    ['$$x$$', '\\$$x$$'],
    ['Key:: value', 'Key\\:: value'],
    ['___', '\\___'],
    ['_ _ _', '\\_ _ _'],
    ['_start_ here', '\\_start_ here'],
    ['[x]: y', '\\[x]: y'],
    ['[^1]: note', '\\[^1]: note'],
    ['[Open](https://example.com)', '[Open](https://example.com)'],
    ['[[Page]] review', '[[Page]] review'],
    ['', null],
    ['   ', null],
  ])('%j is written %j', (typed, source) => {
    expect(buttonLabelSource(typed)).toBe(source)
  })
})
