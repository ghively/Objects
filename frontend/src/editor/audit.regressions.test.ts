/**
 * Regression tests for the editor findings of the 2026-10-28 audit
 * (`docs/superpowers/plans/audit-2026-10-28.md`): each loads a body into a
 * headless editor, applies an edit, saves, and checks the saved Markdown and
 * what it reloads as.
 */
import { Editor as TiptapEditor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { afterEach, describe, expect, test } from 'vitest'
import { editorExtensions, loadBody, serializeBody } from './document'
import { moveBlockTo } from './handles/dragMove'

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

  test('a heading directly followed by its paragraph stays as written', () => {
    const body = '# H\nText\n\nP\n'
    const editor = headless(body)
    expect(serializeBody(editor)).toBe(body)
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

  test('typing into a paragraph that starts with an escape keeps it', () => {
    const editor = headless('\\# not a heading\n\nP\n')
    append(editor, 'heading', '!')
    expect(serializeBody(editor)).toBe('\\# not a heading!\n\nP\n')
  })
})
