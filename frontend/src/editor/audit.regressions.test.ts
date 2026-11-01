/**
 * Regression tests for the editor findings of the 2026-10-28 audit
 * (`docs/superpowers/plans/audit-2026-10-28.md`): each loads a body into a
 * headless editor, applies an edit, saves, and checks the saved Markdown and
 * what it reloads as.
 */
import { Editor as TiptapEditor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { afterEach, describe, expect, test } from 'vitest'
import { formatAnnotation, makeOption, parseAnnotation } from './annotations'
import { editorExtensions, loadBody, serializeBody } from './document'
import { blocksSource, deleteBlocks, selectBlocks, turnInto } from './extensions/blockSelection'
import { moveBlockTo } from './handles/dragMove'
import { codeFence } from './preserve'

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

/**
 * Top-level node types and their text, for comparing what a body loads as
 * (without the empty paragraph the editor keeps after a final code block).
 */
function shape(editor: TiptapEditor): [string, string][] {
  const out: [string, string][] = []
  editor.state.doc.forEach((n) => out.push([n.type.name, n.textContent]))
  const last = out[out.length - 1]
  if (out.length > 1 && last[0] === 'paragraph' && last[1] === '') out.pop()
  return out
}

/** The first node (of `type`, or any textblock) whose text contains `needle`. */
function find(editor: TiptapEditor, needle: string, type?: string): { node: PMNode; pos: number } {
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

/** Type `text` at the end of the first textblock containing `needle`. */
function append(editor: TiptapEditor, needle: string, text: string): void {
  const f = find(editor, needle)
  editor.view.dispatch(editor.state.tr.insertText(text, f.pos + f.node.nodeSize - 1))
}

/** Save, reload, and return the saved text with what it reloads as. */
function saveAndReload(editor: TiptapEditor): { saved: string; reloaded: [string, string][] } {
  const saved = serializeBody(editor)
  return { saved, reloaded: shape(headless(saved)) }
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

  test.each([
    ['A\n\nB\n\nC\n', 'C\n\nA\n\nB\n'],
    ['A\n\nB\n\nC', 'C\n\nA\n\nB'],
    ['A\n\nB\n\nC\n\n', 'C\n\nA\n\nB\n\n'],
  ])('moving the last block of %j to the top keeps the end of the body (audit 2026-11-01)', (body, saved) => {
    const editor = headless(body)
    moveBlockTo(editor, topPos(editor, 'C'), 0)
    expect(serializeBody(editor)).toBe(saved)
  })

  test('joining two paragraphs leaves no blank line at the end', () => {
    const editor = headless('A\n\nB\n')
    editor.commands.setTextSelection(find(editor, 'B').pos + 1)
    editor.commands.joinBackward()
    expect(serializeBody(editor)).toBe('AB\n')
  })

  test('a heading directly followed by its paragraph stays as written', () => {
    const body = '# H\nText\n\nP\n'
    const editor = headless(body)
    expect(serializeBody(editor)).toBe(body)
  })
})

/** Paste `text` as `text/plain` at the selection (a real paste event, not `pasteText`, which pastes as plain text). */
function paste(editor: TiptapEditor, text: string): void {
  const event = new Event('paste', { bubbles: true, cancelable: true }) as Event & { clipboardData: unknown }
  event.clipboardData = { getData: (type: string) => (type === 'text/plain' ? text : ''), types: ['text/plain'], files: [] }
  editor.view.dom.dispatchEvent(event)
}

describe('pasting Markdown text (audit 2026-11-01 #8)', () => {
  test('a copied list pasted back is a list again, with its bytes', () => {
    const editor = headless('* a\n* b\n\nP\n')
    selectBlocks(editor, 0)
    const copied = blocksSource(editor)
    expect(copied).toBe('* a\n* b')
    editor.commands.setTextSelection(find(editor, 'P').pos + 2)
    paste(editor, copied)
    const out = saveAndReload(editor)
    expect(shape(editor)).toEqual([
      ['bulletList', 'ab'],
      ['paragraph', 'P'],
      ['bulletList', 'ab'],
    ])
    expect(out.saved).toBe('* a\n* b\n\nP\n* a\n* b\n')
    expect(out.reloaded).toEqual(shape(editor))
  })

  test('cut and paste keeps the blocks', () => {
    const editor = headless('- a\n- b\n\nP\n')
    selectBlocks(editor, 0)
    const copied = blocksSource(editor)
    deleteBlocks(editor)
    expect(serializeBody(editor)).toBe('P\n')
    editor.commands.setTextSelection(2)
    editor.commands.splitBlock()
    paste(editor, copied)
    expect(shape(editor)).toEqual([
      ['paragraph', 'P'],
      ['bulletList', 'ab'],
    ])
    expect(serializeBody(editor)).toBe('P\n- a\n- b\n')
  })

  test('a list, a heading and a table from elsewhere come in as those blocks', () => {
    const editor = headless('Hello\n\nb\n')
    editor.commands.setTextSelection(find(editor, 'b').pos + 2)
    paste(editor, '- one\n- two\n\n# Head\n\n| a | b |\n|---|---|\n| 1 | 2 |\n')
    const out = saveAndReload(editor)
    expect(shape(editor)).toEqual([
      ['paragraph', 'Hello'],
      ['paragraph', 'b'],
      ['bulletList', 'onetwo'],
      ['heading', 'Head'],
      ['table', 'ab12'],
    ])
    expect(out.saved).toBe('Hello\n\nb\n\n- one\n- two\n\n# Head\n\n| a   | b   |\n| --- | --- |\n| 1   | 2   |\n')
    expect(out.reloaded).toEqual(shape(editor))
  })

  test('a fenced block pasted into the middle of a paragraph splits it', () => {
    const editor = headless('ab\n')
    editor.commands.setTextSelection(2)
    paste(editor, '```js\ncode\n```')
    expect(shape(editor)).toEqual([
      ['paragraph', 'a'],
      ['codeBlock', 'code'],
      ['paragraph', 'b'],
    ])
    expect(serializeBody(editor)).toBe('a\n\n```js\ncode\n```\n\nb\n')
  })

  test('pasted inline Markdown joins the paragraph', () => {
    const editor = headless('Hello world\n')
    editor.commands.setTextSelection(7)
    paste(editor, 'a **b** c')
    expect(shape(editor)).toEqual([['paragraph', 'Hello a b cworld']])
    expect(serializeBody(editor)).toBe('Hello a **b** cworld\n')
  })

  test('plain prose pastes as before, one paragraph per line', () => {
    const editor = headless('Hello world\n\nb\n')
    editor.commands.setTextSelection(7)
    paste(editor, 'line1\nline2\n\npara2')
    expect(shape(editor)).toEqual([
      ['paragraph', 'Hello line1'],
      ['paragraph', 'line2'],
      ['paragraph', 'para2world'],
      ['paragraph', 'b'],
    ])
  })

  test('paste as plain text is left alone', () => {
    const editor = headless('P\n')
    editor.commands.setTextSelection(2)
    ;(globalThis as { ClipboardEvent?: unknown }).ClipboardEvent ??= class extends Event {}
    editor.view.pasteText('- a\n- b')
    expect(shape(editor).map(([t]) => t)).toEqual(['paragraph', 'paragraph'])
  })
})

describe('code blocks', () => {
  test('a code block containing a ``` line keeps it inside', () => {
    const editor = headless('```\nfoo\n```\n')
    append(editor, 'foo', '\n```\nbar')
    const { saved, reloaded } = saveAndReload(editor)
    expect(reloaded).toEqual([['codeBlock', 'foo\n```\nbar']])
    expect(saved).toBe('````\nfoo\n```\nbar\n````\n')
  })

  test.each([
    ['\n~~~', '~~~~\ncode\n~~~\n~~~~\n', 'code\n~~~'],
    ['\n```', '~~~\ncode\n```\n~~~\n', 'code\n```'],
    ['Z', '~~~\ncodeZ\n~~~\n', 'codeZ'],
  ])('a tilde-fenced block keeps its fence when %j is typed inside (audit 2026-11-01 #6)', (typed, saved, text) => {
    const editor = headless('~~~\ncode\n~~~\n')
    append(editor, 'code', typed)
    const out = saveAndReload(editor)
    expect(out.saved).toBe(saved)
    expect(out.reloaded).toEqual([['codeBlock', text]])
  })

  test('an edited tilde-fenced block keeps its info string and indented closing fence', () => {
    const editor = headless('~~~ js \nx\n  ~~~~\n')
    append(editor, 'x', 'Z')
    expect(serializeBody(editor)).toBe('~~~ js \nxZ\n  ~~~~\n')
  })

  test('codeFence counts runs of the fence character only', () => {
    expect(codeFence('a\n~~~\nb', '~')).toBe('~~~~')
    expect(codeFence('a\n```\nb', '~')).toBe('~~~')
    expect(codeFence('a\n~~~\nb')).toBe('```')
  })

  test('a new code block with a ```` line gets a longer fence', () => {
    const editor = headless('Para\n')
    const { schema } = editor
    const code = schema.nodes.codeBlock.create({ language: 'js' }, schema.text('a\n````\nb'))
    editor.view.dispatch(editor.state.tr.replaceWith(0, editor.state.doc.content.size, code))
    const { saved, reloaded } = saveAndReload(editor)
    expect(reloaded).toEqual([['codeBlock', 'a\n````\nb']])
    expect(saved).toBe('`````js\na\n````\nb\n`````\n')
  })
})

/** Delete the first node of `type` whose text is exactly `text`. */
function deleteNode(editor: TiptapEditor, text: string, type: string): void {
  let at = -1
  let size = 0
  editor.state.doc.descendants((n, pos) => {
    if (at < 0 && n.type.name === type && n.textContent === text) {
      at = pos
      size = n.nodeSize
    }
    return at < 0
  })
  if (at < 0) throw new Error(`no ${type} ${text}`)
  editor.view.dispatch(editor.state.tr.delete(at, at + size))
}

/** The `start` of every ordered list, in document order. */
function listStarts(editor: TiptapEditor): number[] {
  const out: number[] = []
  editor.state.doc.descendants((n) => {
    if (n.type.name === 'orderedList') out.push(n.attrs.start as number)
  })
  return out
}

describe('numbered lists', () => {
  test('deleting the first item keeps the list starting at 1', () => {
    const editor = headless('1. a\n2. b\n3. c\n')
    deleteNode(editor, 'a', 'listItem')
    const saved = serializeBody(editor)
    expect(saved).toBe('1. b\n3. c\n')
    expect(listStarts(headless(saved))).toEqual([1])
  })

  test('deleting the first item of a list starting at 5 keeps 5', () => {
    const editor = headless('5. a\n6. b\n')
    deleteNode(editor, 'a', 'listItem')
    expect(serializeBody(editor)).toBe('5. b\n')
  })

  test('deleting the first item of a nested list keeps it starting at 1', () => {
    const editor = headless('- x\n    1. alpha\n    2. beta\n- y\n')
    deleteNode(editor, 'alpha', 'listItem')
    expect(serializeBody(editor)).toBe('- x\n    1. beta\n- y\n')
  })
})

describe('edits that only add whitespace or a hard break', () => {
  test('trailing spaces typed in a code block are saved', () => {
    const editor = headless('```\nfoo\n```\n')
    append(editor, 'foo', '   ')
    expect(serializeBody(editor)).toBe('```\nfoo   \n```\n')
  })

  test('indenting an empty line in a code block is saved', () => {
    const editor = headless('```\nfoo\n\nbar\n```\n')
    const f = find(editor, 'foo', 'codeBlock')
    editor.view.dispatch(editor.state.tr.insertText('    ', f.pos + 1 + 'foo\n'.length))
    expect(serializeBody(editor)).toBe('```\nfoo\n    \nbar\n```\n')
  })

  test('turning a line break into a hard break (Shift-Enter) is saved', () => {
    const editor = headless('a\nb\n')
    const f = find(editor, 'a')
    const at = f.pos + 1 + f.node.textContent.indexOf('\n')
    editor.view.dispatch(editor.state.tr.replaceWith(at, at + 1, editor.schema.nodes.hardBreak.create()))
    const saved = serializeBody(editor)
    expect(saved).toBe('a  \nb\n')
    let breaks = 0
    headless(saved).state.doc.descendants((n) => {
      if (n.type.name === 'hardBreak') breaks++
    })
    expect(breaks).toBe(1)
  })

  test('an edit on one line keeps the other lines exactly, trailing spaces included', () => {
    const editor = headless('one   \ntwo\n')
    append(editor, 'two', 'X')
    expect(serializeBody(editor)).toBe('one   \ntwoX\n')
  })
})

describe('paragraphs with URLs and entities', () => {
  test.each([
    ['see https://a.b/c_d_e x', 'x'],
    ['https://example.com and more', 'more'],
    ['see <https://a.b> x', 'x'],
    ['mail me@example.com now', 'now'],
    ['www.example.com here', 'here'],
    ['a&nbsp;b x', 'x'],
  ])('%s loads as a paragraph and saves as written', (line, last) => {
    const editor = headless(line + '\n')
    expect(shape(editor).map(([type]) => type)).toEqual(['paragraph'])
    append(editor, last, 'Y')
    expect(serializeBody(editor)).toBe(line + 'Y\n')
  })

  test('&nbsp; shows as a non-breaking space', () => {
    expect(shape(headless('a&nbsp;b\n'))).toEqual([['paragraph', 'a' + String.fromCharCode(0xa0) + 'b']])
  })

  test('a link whose text was changed is written in full', () => {
    const editor = headless('see <https://a.b> x\n')
    const f = find(editor, 'see')
    editor.view.dispatch(editor.state.tr.insertText('Site', f.pos + 1 + 4, f.pos + 1 + 4 + 'https://a.b'.length))
    expect(serializeBody(editor)).toBe('see [Site](https://a.b) x\n')
  })
})

describe('reference links and footnotes', () => {
  test.each([
    ['see [a][r] x', '[r]: http://x'],
    ['see [a][] x', '[a]: http://x'],
    ['See[^1] x', '[^1]: note'],
  ])('%j keeps its brackets when edited', (line, def) => {
    const editor = headless(`${line}\n\n${def}\n`)
    append(editor, 'x', 'Y')
    expect(serializeBody(editor)).toBe(`${line}Y\n\n${def}\n`)
  })

  test('other brackets are still escaped', () => {
    const editor = headless('P\n')
    setParagraph(editor, 'a [b] c')
    expect(serializeBody(editor)).toBe('a \\[b\\] c\n')
  })
})

describe('minor drift on edited lines', () => {
  test('an edited lazy blockquote line stays lazy', () => {
    const editor = headless('> a\nlazy\n')
    append(editor, 'lazy', 'X')
    expect(serializeBody(editor)).toBe('> a\nlazyX\n')
  })

  test.each([
    ['- a\\\n  b\n', '- a\\\n  bX\n'],
    ['- a  \n  b\n', '- a  \n  bX\n'],
    ['1. a\\\n   b\n', '1. a\\\n   bX\n'],
  ])('a list item continuation after a hard break keeps its indent (%j)', (body, saved) => {
    const editor = headless(body)
    append(editor, 'b', 'X')
    expect(serializeBody(editor)).toBe(saved)
  })

  test('Shift-Enter at the end of a list item is saved as a hard break (audit 2026-11-01)', () => {
    const editor = headless('- a\n- b\n')
    editor.commands.setTextSelection(find(editor, 'b').pos + 2)
    editor.commands.setHardBreak()
    editor.view.dispatch(editor.state.tr.insertText('cont'))
    const saved = serializeBody(editor)
    expect(saved).toBe('- a\n- b  \n  cont\n')
    let breaks = 0
    headless(saved).state.doc.descendants((n) => {
      if (n.type.name === 'hardBreak') breaks++
    })
    expect(breaks).toBe(1)
  })

  test('editing one line of a nested blockquote keeps the other lines (audit 2026-11-01)', () => {
    const editor = headless('> a\n> > b\n> c\n')
    append(editor, 'a', 'Z')
    const out = saveAndReload(editor)
    expect(out.saved).toBe('> aZ\n>\n> > b\n> c\n')
    expect(out.reloaded).toEqual([['blockquote', 'aZb\nc']])
  })

  test('a tab-indented sibling item is kept when another item is edited (audit 2026-11-01)', () => {
    const editor = headless('- a\n   - b\n\t- c\n')
    append(editor, 'a', 'Z')
    expect(serializeBody(editor)).toBe('- aZ\n   - b\n\t- c\n')
  })

  test('an edited blockquote line keeps its marker', () => {
    const editor = headless('> a\n> b\n')
    append(editor, 'b', 'X')
    expect(serializeBody(editor)).toBe('> a\n> bX\n')
  })
})

describe('annotation values', () => {
  test.each(['a --> b', '-->', 'x--->y', 'quote " and \\ backslash -->'])('caption %j round-trips', (caption) => {
    const line = formatAnnotation({ type: 'leaf', options: [makeOption('caption', caption)] })
    expect(line).not.toMatch(/-->.*-->/)
    expect(parseAnnotation(line)?.options).toEqual([expect.objectContaining({ key: 'caption', value: caption })])
  })

  test('a value with an old "-- >" still reads as written', () => {
    expect(parseAnnotation('<!-- block: caption="a -- > b" -->')?.options[0].value).toBe('a -- > b')
  })
})

describe('lines with ::', () => {
  test.each([
    ['Use std::vector here', 'paragraph'],
    ['- a::b\n- c', 'bulletList'],
    ['| a | b |\n|---|---|\n| x::y | z |', 'table'],
  ])('%j is not a field line', (body, type) => {
    expect(shape(headless(body + '\n')).map(([t]) => t)).toEqual([type])
  })

  test.each(['Status:: Active', 'Owner:: [[Ada]]', 'Due date::'])('%j stays a raw field line', (line) => {
    expect(shape(headless(line + '\n')).map(([t]) => t)).toEqual(['rawBlock'])
  })
})

/** Every task item's checked state, in document order. */
function checks(editor: TiptapEditor): boolean[] {
  const out: boolean[] = []
  editor.state.doc.descendants((n) => {
    if (n.type.name === 'taskItem') out.push(n.attrs.checked as boolean)
  })
  return out
}

describe('to-do lists with [X] or plain items (audit 2026-11-01, Gene: accept both)', () => {
  test('an uppercase [X] loads as a done task list and keeps its bytes', () => {
    const body = '* [ ] a\n* [X] b\n'
    const editor = headless(body)
    expect(shape(editor)).toEqual([['taskList', 'ab']])
    expect(checks(editor)).toEqual([false, true])
    expect(serializeBody(editor)).toBe(body)
    append(editor, 'a', 'Z')
    expect(serializeBody(editor)).toBe('* [ ] aZ\n* [X] b\n')
  })

  test.each([
    ['- [ ] a\n- plain\n', [false]],
    ['- plain\n- [ ] a\n', [false]],
    ['- [X] done\n- plain\n  - [x] nested\n', [true, true]],
  ])('%j loads as a bullet list with task items', (body, checked) => {
    const editor = headless(body)
    expect(shape(editor).map(([t]) => t)).toEqual(['bulletList'])
    expect(checks(editor)).toEqual(checked)
    expect(serializeBody(editor)).toBe(body)
  })

  test('editing one item of a mixed list changes only its line', () => {
    const editor = headless('- [ ] a\n- plain\n  - [x] nested\n')
    append(editor, 'plain', 'Z')
    const out = saveAndReload(editor)
    expect(out.saved).toBe('- [ ] a\n- plainZ\n  - [x] nested\n')
    expect(out.reloaded).toEqual([['bulletList', 'aplainZnested']])
  })

  test('a to-do list followed by a paragraph after a blank line is still one list', () => {
    const editor = headless('- [ ] a\n- [x] b\n\nAfter\n')
    expect(shape(editor)).toEqual([
      ['taskList', 'ab'],
      ['paragraph', 'After'],
    ])
  })
})

describe('math blocks (audit 2026-11-01)', () => {
  test.each([
    ['x\n$$\ny', '$$\nx\n\\$$\ny\n$$\n'],
    ['x $$', '$$\nx \\$$\n$$\n'],
  ])('a formula containing %j at a line end stays one block', (text, saved) => {
    const editor = headless('$$\nx\n$$\n')
    editor.view.dispatch(editor.state.tr.setNodeAttribute(0, 'text', text))
    expect(serializeBody(editor)).toBe(saved)
    const again = headless(saved)
    expect(shape(again)).toEqual([['mathBlock', '']])
    expect(again.state.doc.firstChild!.attrs.text).toBe(text)
    expect(serializeBody(again)).toBe(saved)
  })
})

describe('typed field and footnote definition lines (audit 2026-11-01)', () => {
  test.each([
    ['Key:: value', 'Key\\:: value'],
    ['[^1]: footnote', '\\[^1\\]: footnote'],
  ])('%j typed stays a paragraph', (text, saved) => {
    const editor = headless('P\n')
    setParagraph(editor, text)
    const out = saveAndReload(editor)
    expect(out.saved).toBe(saved + '\n')
    expect(out.reloaded).toEqual([['paragraph', text]])
    const again = headless(out.saved)
    append(again, 'e', 'Z')
    expect(serializeBody(again)).toBe(saved + 'Z\n')
  })

  test('a footnote reference in text keeps its brackets', () => {
    const editor = headless('P\n')
    setParagraph(editor, 'a [^1] b')
    expect(serializeBody(editor)).toBe('a [^1] b\n')
  })

  test('a field line in a file still loads raw', () => {
    expect(shape(headless('Key:: value\n')).map(([t]) => t)).toEqual(['rawBlock'])
  })
})

describe('headings', () => {
  test.each([
    [' #', '## Title \\#'],
    [' ##', '## Title \\##'],
  ])('a heading ending in %j keeps it', (typed, saved) => {
    const editor = headless('## Title\n\nP\n')
    append(editor, 'Title', typed)
    const out = saveAndReload(editor)
    expect(out.saved).toBe(saved + '\n\nP\n')
    expect(out.reloaded[0]).toEqual(['heading', 'Title' + typed])
  })

  test('turning a two-line paragraph into a heading keeps one heading', () => {
    const editor = headless('a\nb\n\nP\n')
    editor.commands.setTextSelection(find(editor, 'a').pos + 1)
    turnInto(editor, 'H2')
    const out = saveAndReload(editor)
    expect(out.saved).toBe('## a b\n\nP\n')
    expect(out.reloaded).toEqual([
      ['heading', 'a b'],
      ['paragraph', 'P'],
    ])
  })

  test('a hard break in a heading saves as a space', () => {
    const editor = headless('## a\n')
    const f = find(editor, 'a')
    editor.view.dispatch(
      editor.state.tr.insert(f.pos + 2, [editor.schema.nodes.hardBreak.create(), editor.schema.text('b')]),
    )
    const out = saveAndReload(editor)
    expect(out.saved).toBe('## a b\n')
    expect(out.reloaded).toEqual([['heading', 'a b']])
  })

  test('a # inside a word is left alone', () => {
    const editor = headless('## Title\n')
    append(editor, 'Title', ' C#')
    expect(serializeBody(editor)).toBe('## Title C#\n')
  })
})

/** Replace the whole document with one paragraph of `text` (lines joined by hard breaks). */
function setParagraph(editor: TiptapEditor, text: string): void {
  const { schema } = editor
  const content = text
    .split('\n')
    .flatMap((line, i) => [...(i ? [schema.nodes.hardBreak.create()] : []), ...(line ? [schema.text(line)] : [])])
  const para = schema.nodes.paragraph.create(null, content)
  editor.view.dispatch(editor.state.tr.replaceWith(0, editor.state.doc.content.size, para))
}

describe('plain text that looks like Markdown', () => {
  test.each([
    ['# x', '\\# x'],
    ['- x', '\\- x'],
    ['+ x', '\\+ x'],
    ['1. x', '1\\. x'],
    ['2024. was good', '2024\\. was good'],
    ['1) a', '1\\) a'],
    ['---', '\\---'],
    ['$b$', '\\$b$'],
    ['a $x$ b', 'a \\$x$ b'],
    ['$$x$$', '\\$\\$x$$'],
  ])('%s stays a paragraph', (text, saved) => {
    const editor = headless('P\n')
    setParagraph(editor, text)
    const out = saveAndReload(editor)
    expect(out.saved).toBe(saved + '\n')
    expect(out.reloaded).toEqual([['paragraph', text]])
  })

  test.each([
    ['a\n# b', 'a  \n\\# b'],
    ['a\n- b', 'a  \n\\- b'],
    ['a\n---', 'a  \n\\---'],
    ['a\n===', 'a  \n\\==='],
  ])('a hard break before %j keeps one paragraph', (text, saved) => {
    const editor = headless('P\n')
    setParagraph(editor, text)
    const out = saveAndReload(editor)
    expect(out.saved).toBe(saved + '\n')
    expect(out.reloaded).toEqual([['paragraph', text.replace('\n', '')]])
  })

  test.each(['#hashtag', 'a # b', 'x - y', '-x', '1.5 is a number', '$5 and $6', '=====', '-- x'])(
    '%s is not escaped',
    (text) => {
      const editor = headless('P\n')
      setParagraph(editor, text)
      expect(serializeBody(editor)).toBe(text + '\n')
    },
  )

  test.each([
    ['    four spaces', '&nbsp;   four spaces'],
    ['\tTabbed', '&nbsp;Tabbed'],
    ['  \t mixed', '&nbsp; \t mixed'],
  ])('a paragraph starting with %j stays a paragraph (audit 2026-11-01 #7)', (text, saved) => {
    const editor = headless('P\n')
    setParagraph(editor, text)
    const out = saveAndReload(editor)
    expect(out.saved).toBe(saved + '\n')
    expect(out.reloaded).toEqual([['paragraph', String.fromCharCode(0xa0) + text.slice(1)]])
    // Reloaded and edited again, the line keeps that form.
    const again = headless(out.saved)
    append(again, 'e', 'Z')
    expect(serializeBody(again)).toBe(saved + 'Z\n')
  })

  test('a later line of a paragraph may be indented', () => {
    const editor = headless('P\n')
    setParagraph(editor, 'a\n    b')
    expect(serializeBody(editor)).toBe('a  \n    b\n')
  })

  test('typing into a paragraph that starts with an escape keeps it', () => {
    const editor = headless('\\# not a heading\n\nP\n')
    append(editor, 'heading', '!')
    expect(serializeBody(editor)).toBe('\\# not a heading!\n\nP\n')
  })
})
