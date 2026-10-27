import { Editor as TiptapEditor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import { afterEach, describe, expect, test } from 'vitest'
import { makeBigBody } from './__fixtures__/bigBody'
import type { Option } from './annotations'
import { editorExtensions, loadBody, serializeBody } from './document'
import { turnInto } from './extensions/blockSelection'

const fixtures = import.meta.glob('./__fixtures__/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const EVERY = fixtures['./__fixtures__/blocks-every.md']
const HANDWRITTEN = fixtures['./__fixtures__/blocks-handwritten.md']
const CRLF = fixtures['./__fixtures__/blocks-crlf.md']

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

type Found = { node: PMNode; pos: number }

/** Every node of `type` (document order). */
function all(editor: TiptapEditor, type: string): Found[] {
  const out: Found[] = []
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === type) out.push({ node, pos })
  })
  return out
}

/** The first block node whose text contains `text`. */
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

/** Put the cursor at the end of the text block holding `text`. */
function cursorIn(editor: TiptapEditor, text: string): Found {
  const b = blockWith(editor, text)
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, b.pos + b.node.nodeSize - 1)))
  return b
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

/** Lines in `b` not in `a` (and vice versa), as multisets in order: a tiny diff for inserted/removed lines. */
function addedRemoved(a: string, b: string): { added: string[]; removed: string[] } {
  const la = a.split('\n')
  const lb = b.split('\n')
  let i = 0
  while (i < la.length && i < lb.length && la[i] === lb[i]) i++
  let ea = la.length
  let eb = lb.length
  while (ea > i && eb > i && la[ea - 1] === lb[eb - 1]) {
    ea--
    eb--
  }
  return { added: lb.slice(i, eb), removed: la.slice(i, ea) }
}

const opts = (node: PMNode) => ((node.attrs.blockOptions as Option[] | null) ?? []).map((o) => o.raw)

describe('M7 document model', () => {
  test('no-edit save is byte identical for every fixture', () => {
    for (const [name, body] of Object.entries({ ...fixtures, big: makeBigBody() })) {
      const editor = headless(body)
      expect(serializeBody(editor), name).toBe(body)
    }
  }, 30_000)

  test('annotated leaves load with their options', () => {
    const editor = headless(EVERY)
    const heading = blockWith(editor, 'Rollout notes')
    expect(heading.node.type.name).toBe('heading')
    expect(opts(heading.node)).toEqual(['color=bg-blue', 'align=center'])
    expect(heading.node.attrs.blockAnnotation).toBe('<!-- block: color=bg-blue align=center -->\n')
    expect(opts(blockWith(editor, 'Fine print').node)).toEqual(['small'])
    expect(opts(blockWith(editor, 'block icon').node)).toEqual(['icon=ph-star'])
    const quote = all(editor, 'blockquote')[0]
    expect(opts(quote.node)).toEqual(['quote=standout'])
    const lists = all(editor, 'orderedList').filter((l) => l.node.attrs.blockOptions)
    expect(lists.map((l) => opts(l.node))).toEqual([['list=alphabetical'], ['list=roman']])
    const codes = all(editor, 'codeBlock')
    expect(opts(codes[0].node)).toEqual(['wrap', 'lock'])
    expect(opts(codes[1].node)).toEqual(['preview=split'])
    const tables = all(editor, 'table')
    expect(opts(tables[0].node)).toEqual(['header-column'])
    expect(opts(tables[1].node)).toEqual(['no-header-row'])
    const media = all(editor, 'media')
    expect(media.map((m) => m.node.attrs.kind)).toEqual(['image', 'pdf', 'audio', 'video', 'file'])
    expect(opts(media[0].node)).toEqual(['width=120', 'align=center', 'caption="A \\"tiny\\" pixel"'])
    expect(media[0].node.attrs).toMatchObject({ form: 'md', src: 'Attachments/pixel.png', alt: 'pixel' })
    expect(opts(media[1].node)).toEqual(['height=500'])
    expect(media[1].node.attrs).toMatchObject({ form: 'wiki', target: 'Attachments/report.pdf' })
    const bookmark = all(editor, 'bookmark')
    expect(bookmark).toHaveLength(1)
    expect(bookmark[0].node.attrs).toMatchObject({ href: 'https://example.com/docs', title: 'Example docs' })
    expect(opts(bookmark[0].node)).toEqual(['bookmark'])
    const embeds = all(editor, 'objectEmbed')
    expect(embeds.map((e) => e.node.attrs.target)).toEqual(['Ada Lovelace', 'Embedded target'])
    expect(opts(embeds[0].node)).toEqual(['view=wideCard'])
    expect(embeds[1].node.attrs.blockOptions).toBeNull()
  })

  test('containers load with their children and columns', () => {
    const editor = headless(EVERY)
    const toggles = all(editor, 'toggle')
    expect(toggles).toHaveLength(2)
    expect(opts(toggles[0].node)).toEqual([])
    expect(toggles[0].node.firstChild!.type.name).toBe('heading')
    expect(toggles[0].node.childCount).toBe(3)
    expect(opts(toggles[1].node)).toEqual(['open'])
    expect(toggles[1].node.attrs.containerOpen).toBe('<!-- toggle open -->\n')
    expect(toggles[1].node.attrs.containerClose).toMatch(/^<!-- \/toggle -->\n?$/)
    const group = all(editor, 'group')[0].node
    expect(opts(group)).toEqual(['color=bg-gray'])
    expect(group.textContent).toContain('Box heading')
    const columns = all(editor, 'columns')
    expect(columns.map((c) => c.node.childCount)).toEqual([2, 3])
    expect(opts(columns[0].node)).toEqual(['widths=40,60'])
    expect(columns[1].node.child(1).attrs.separator).toBe('<!-- column -->\n')
    expect(columns[1].node.child(0).attrs.separator).toBeNull()
    expect(columns[1].node.child(2).textContent).toBe('Three')

    // Nested: columns > column > group > toggle (hand-written spellings).
    const hand = headless(HANDWRITTEN)
    const nested = all(hand, 'columns')[0].node
    expect(nested.child(1).firstChild!.type.name).toBe('group')
    expect(nested.child(1).firstChild!.firstChild!.type.name).toBe('toggle')
    expect(all(hand, 'toggle').map((t) => opts(t.node))).toEqual([['open'], []])
  })

  test('option change rewrites only the annotation line', () => {
    const editor = headless(EVERY)
    const heading = blockWith(editor, 'Rollout notes')
    editor.commands.setBlockOption('color', 'text-red', heading.pos)
    const out = serializeBody(editor)
    expect(lineDiff(EVERY, out)).toEqual([
      { index: 0, before: '<!-- block: color=bg-blue align=center -->', after: '<!-- block: color=text-red align=center -->' },
    ])
    // Through the selection, on a media atom.
    const media = all(editor, 'media')[0]
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, media.pos)))
    editor.commands.setBlockOption('width', '200')
    const out2 = serializeBody(editor)
    expect(lineDiff(out, out2)).toEqual([
      {
        index: expect.any(Number) as unknown as number,
        before: '<!-- block: width=120 align=center caption="A \\"tiny\\" pixel" -->',
        after: '<!-- block: align=center width=200 caption="A \\"tiny\\" pixel" -->',
      },
    ])
  })

  test('removing the last option removes only its line', () => {
    const editor = headless(EVERY)
    cursorIn(editor, 'Fine print')
    expect(editor.commands.setBlockOption('small', null)).toBe(true)
    const out = serializeBody(editor)
    expect(addedRemoved(EVERY, out)).toEqual({ added: [], removed: ['<!-- block: small -->'] })
  })

  test('adding the first option inserts one line above', () => {
    const body = 'Intro.\n\nTarget paragraph.\n\nOutro.\n'
    const editor = headless(body)
    cursorIn(editor, 'Target')
    editor.commands.setBlockOption('align', 'center')
    expect(serializeBody(editor)).toBe('Intro.\n\n<!-- block: align=center -->\nTarget paragraph.\n\nOutro.\n')
    // Taking it off again gives the original bytes back.
    editor.commands.setBlockOption('align', null)
    expect(serializeBody(editor)).toBe(body)
    // A known option that does not apply to the block is refused.
    expect(editor.commands.setBlockOption('wrap', true)).toBe(false)
  })

  test('edit inside a toggle rewrites only that child', () => {
    const editor = headless(EVERY)
    typeAtEndOf(editor, 'Details in', ' Now.')
    const out = serializeBody(editor)
    expect(lineDiff(EVERY, out)).toEqual([
      { index: expect.any(Number) as unknown as number, before: 'Details in [[Runbook]].', after: 'Details in [[Runbook]]. Now.' },
    ])
    // The toggle lost its verbatim source, its siblings kept theirs.
    const toggle = all(editor, 'toggle')[1].node
    expect(toggle.attrs.blockSource).toBeNull()
    expect(toggle.firstChild!.attrs.blockSource).toBe('### Server checklist\n')
    expect(all(editor, 'toggle')[0].node.attrs.blockSource).not.toBeNull()
  })

  test('edit inside a column of a nested container rewrites only that child', () => {
    const editor = headless(HANDWRITTEN)
    typeAtEndOf(editor, 'Nested child', '!')
    const out = serializeBody(editor)
    expect(lineDiff(HANDWRITTEN, out)).toEqual([
      { index: expect.any(Number) as unknown as number, before: 'Nested child.', after: 'Nested child.!' },
    ])
  })

  test('toggling open rewrites only the open line', () => {
    const editor = headless(EVERY)
    const closed = all(editor, 'toggle')[0]
    editor.commands.setToggleOpen(closed.pos, true)
    let out = serializeBody(editor)
    expect(lineDiff(EVERY, out)).toEqual([
      { index: expect.any(Number) as unknown as number, before: '<!-- toggle -->', after: '<!-- toggle open -->' },
    ])
    editor.commands.setToggleOpen(all(editor, 'toggle')[1].pos, false)
    out = serializeBody(editor)
    expect(lineDiff(EVERY, out).map((d) => d.after)).toEqual(['<!-- toggle open -->', '<!-- toggle -->'])
    // Back to the original state: the original bytes.
    editor.commands.setToggleOpen(all(editor, 'toggle')[0].pos, false)
    editor.commands.setToggleOpen(all(editor, 'toggle')[1].pos, true)
    expect(serializeBody(editor)).toBe(EVERY)
  })

  test('hand-written open line spelling is kept until its options change', () => {
    const editor = headless(HANDWRITTEN)
    const toggle = all(editor, 'toggle')[0]
    editor.commands.setBlockOption('foo', 'bar', toggle.pos)
    const out = serializeBody(editor)
    expect(lineDiff(HANDWRITTEN, out)).toEqual([
      { index: expect.any(Number) as unknown as number, before: '<!--   TOGGLE   open-->', after: '<!-- toggle open foo=bar -->' },
    ])
  })

  test('new containers serialize canonically with the document EOL', () => {
    const editor = headless('First.\n\nSecond.\n\nThird.\n')
    cursorIn(editor, 'Second')
    expect(editor.commands.wrapInToggle()).toBe(true)
    expect(serializeBody(editor)).toBe('First.\n\n<!-- toggle open -->\nSecond.\n<!-- /toggle -->\n\nThird.\n')

    const crlf = headless('First.\r\n\r\nSecond.\r\n\r\nThird.\r\n')
    cursorIn(crlf, 'Second')
    crlf.commands.wrapInGroup()
    expect(serializeBody(crlf)).toBe('First.\r\n\r\n<!-- group -->\r\nSecond.\r\n<!-- /group -->\r\n\r\nThird.\r\n')

    const cols = headless('Above.\r\n')
    cursorIn(cols, 'Above')
    cols.commands.insertColumns(2)
    expect(serializeBody(cols)).toBe('Above.\r\n\r\n<!-- columns -->\r\n<!-- column -->\r\n<!-- /columns -->\r\n')
    // Type into the second column: it appears after the separator.
    const second = all(cols, 'column')[1]
    cols.commands.insertContentAt(second.pos + 2, 'Right')
    expect(serializeBody(cols)).toBe('Above.\r\n\r\n<!-- columns -->\r\n<!-- column -->\r\nRight\r\n<!-- /columns -->\r\n')
    // And it loads back as the same structure.
    const again = headless(serializeBody(cols))
    expect(all(again, 'column').map((c) => c.node.textContent)).toEqual(['', 'Right'])
  })

  test('CRLF document inserts CRLF annotation lines', () => {
    const editor = headless(CRLF)
    const first = blockWith(editor, 'CRLF blocks')
    editor.commands.setBlockOption('color', 'bg-red', first.pos)
    const out = serializeBody(editor)
    expect(out.replace(/\r\n/g, '')).not.toContain('\n')
    const { added, removed } = addedRemoved(CRLF.replace(/\r\n/g, '\n'), out.replace(/\r\n/g, '\n'))
    expect(removed).toEqual([])
    expect(added).toEqual(['<!-- block: color=bg-red -->'])
  })

  test('unknown options survive an edit', () => {
    const editor = headless(HANDWRITTEN)
    // The block with `color=bg-green foo=bar`: change the colour, keep foo=bar after it.
    const b = blockWith(editor, 'A known option beside')
    editor.commands.setBlockOption('color', 'bg-blue', b.pos)
    typeAtEndOf(editor, 'A known option beside', ' Edited.')
    const purple = blockWith(editor, 'An unknown colour value')
    editor.commands.setBlockOption('small', true, purple.pos)
    const out = serializeBody(editor)
    expect(lineDiff(HANDWRITTEN, out).map(({ before, after }) => [before, after])).toEqual([
      ['<!-- block: color=bg-green foo=bar -->', '<!-- block: color=bg-blue foo=bar -->'],
      ['A known option beside an unknown one.', 'A known option beside an unknown one. Edited.'],
      ['<!-- block: color=bg-purplish -->', '<!-- block: small color=bg-purplish -->'],
    ])
  })

  test('malformed annotations survive an edit elsewhere', () => {
    const editor = headless(HANDWRITTEN)
    typeAtEndOf(editor, 'Tight annotation', ' x')
    const out = serializeBody(editor)
    expect(lineDiff(HANDWRITTEN, out).map((d) => d.after)).toEqual(['# Tight annotation x'])
    for (const line of [
      '<!-- callout -->',
      '<!-- /callout -->',
      '<!-- toggle -->\nA toggle that never closes.',
      '<!-- /group -->\nA stray close above.',
      '<!-- block: small -->\n\nA detached annotation',
      '<!-- block: wrap -->\nNot a code block',
      '<!-- TODO: tidy -->',
    ])
      expect(out).toContain(line)
  })

  test('undo restores original bytes', () => {
    const editor = headless(EVERY)
    typeAtEndOf(editor, 'Hidden child paragraph', ' typed')
    editor.commands.setBlockOption('color', 'text-red', blockWith(editor, 'Rollout notes').pos)
    expect(serializeBody(editor)).not.toBe(EVERY)
    editor.commands.undo()
    editor.commands.undo()
    expect(serializeBody(editor)).toBe(EVERY)
    // A container regains its verbatim source once its content is back.
    expect(all(editor, 'toggle')[0].node.attrs.blockSource).not.toBeNull()
  })

  test('moving a block keeps its bytes', () => {
    const body = 'A *one*  \n\n<!-- block: small -->\nB _two_\n\n<!--toggle open-->\nC\n<!-- /toggle -->\n\nD\n'
    const editor = headless(body)
    const doc = editor.state.doc
    const a = doc.child(0)
    const b = doc.child(1)
    // Move A below B, and the toggle below D, in one plain transaction.
    const tr = editor.state.tr
    tr.replaceWith(0, a.nodeSize + b.nodeSize, [b, a])
    const toggle = tr.doc.child(2)
    const d = tr.doc.child(3)
    const start = a.nodeSize + b.nodeSize
    tr.replaceWith(start, start + toggle.nodeSize + d.nodeSize, [d, toggle])
    editor.view.dispatch(tr)
    expect(serializeBody(editor)).toBe('<!-- block: small -->\nB _two_\n\nA *one*  \n\nD\n<!--toggle open-->\nC\n<!-- /toggle -->\n\n')
  })

  test('math block, inline math, media, object embed and bookmark round trip and edit canonically', () => {
    const editor = headless(EVERY)
    const math = all(editor, 'mathBlock')
    expect(math).toHaveLength(1)
    expect(math[0].node.attrs.text).toBe('E = mc^2\n\na^2 + b^2 = c^2')
    const inline = all(editor, 'inlineMath')
    expect(inline.map((i) => i.node.attrs.text)).toEqual(['a^2+b^2=c^2'])

    // Edit the inline formula's paragraph elsewhere: the formula is written back as $…$.
    typeAtEndOf(editor, 'The theorem says', ' Done.')
    // Edit the math block's text: written in the canonical form.
    editor.view.dispatch(editor.state.tr.setNodeAttribute(all(editor, 'mathBlock')[0].pos, 'text', 'x^2'))
    // Re-target the object embed and the media.
    editor.view.dispatch(editor.state.tr.setNodeAttribute(all(editor, 'objectEmbed')[1].pos, 'target', 'Other'))
    editor.view.dispatch(editor.state.tr.setNodeAttribute(all(editor, 'media')[2].pos, 'label', 'Clip'))
    editor.view.dispatch(editor.state.tr.setNodeAttribute(all(editor, 'bookmark')[0].pos, 'title', 'Docs'))
    const out = serializeBody(editor)
    expect(out).toContain('$$\nx^2\n$$\n')
    expect(out).toContain('for right triangles, and a coffee costs $5 and $6 on weekends. Done.')
    expect(out).toContain('The theorem says $a^2+b^2=c^2$ for')
    expect(out).toContain('\n![[Other]]')
    expect(out).toContain('\n![[Attachments/clip.wav|Clip]]\n')
    expect(out).toContain('<!-- block: bookmark -->\n[Docs](https://example.com/docs)\n')
    expect(out).not.toContain('E = mc^2')

    // A one-line math block loads and edits to the canonical form.
    const one = headless('Before\n\n$$x+1$$\n\nAfter\n')
    expect(all(one, 'mathBlock')[0].node.attrs.text).toBe('x+1')
    one.view.dispatch(one.state.tr.setNodeAttribute(all(one, 'mathBlock')[0].pos, 'text', 'x+2'))
    expect(serializeBody(one)).toBe('Before\n\n$$\nx+2\n$$\n\nAfter\n')

    // New blocks of every kind are written canonically.
    const fresh = headless('Start\n')
    cursorIn(fresh, 'Start')
    fresh.commands.insertMathBlock('a=b')
    fresh.commands.setTextSelection(fresh.state.doc.content.size)
    fresh.commands.insertBookmark('https://pve.proxmox.com/wiki', 'Proxmox docs')
    expect(serializeBody(fresh)).toBe(
      'Start\n\n$$\na=b\n$$\n\n<!-- block: bookmark -->\n[Proxmox docs](https://pve.proxmox.com/wiki)\n',
    )
    const back = headless(serializeBody(fresh))
    expect(all(back, 'mathBlock')).toHaveLength(1)
    expect(all(back, 'bookmark')).toHaveLength(1)
  })

  test('mermaid fence loads as a code block', () => {
    const body = 'Intro\n\n```mermaid\ngraph TD\n  A --> B\n```\n'
    const editor = headless(body)
    const code = all(editor, 'codeBlock')
    expect(code).toHaveLength(1)
    expect(code[0].node.attrs.language).toBe('mermaid')
    expect(all(editor, 'rawBlock')).toHaveLength(0)
    expect(serializeBody(editor)).toBe(body)
    typeAtEndOf(editor, 'Intro', '!')
    expect(serializeBody(editor)).toBe(body.replace('Intro', 'Intro!'))
  })

  test('numbered list input rule can be turned off', () => {
    const on = headless('')
    on.commands.insertContentAt(1, 'x')
    on.commands.setTextSelection(1)
    on.commands.deleteRange({ from: 1, to: 2 })
    // Type "1. " through the input-rule path.
    const typeText = (ed: TiptapEditor, text: string) => {
      for (const ch of text) {
        const { from, to } = ed.state.selection
        const handled = ed.view.someProp('handleTextInput', (f) => f(ed.view, from, to, ch, () => ed.state.tr.insertText(ch, from, to)))
        if (!handled) ed.view.dispatch(ed.state.tr.insertText(ch, from, to))
      }
    }
    typeText(on, '1. ')
    expect(all(on, 'orderedList')).toHaveLength(1)

    const off = headless('', { numberedListInputRule: false })
    typeText(off, '1. ')
    expect(all(off, 'orderedList')).toHaveLength(0)
    expect(off.state.doc.textContent).toBe('1. ')
    // Bullets still convert.
    const bullets = headless('', { numberedListInputRule: false })
    typeText(bullets, '- ')
    expect(all(bullets, 'bulletList')).toHaveLength(1)
  })

  test('commands set options, wrap and unwrap containers and insert every new block', () => {
    const editor = headless('Title line\n\nBody text.\n')
    cursorIn(editor, 'Title')
    expect(editor.commands.setHierarchy('H2')).toBe(true)
    expect(blockWith(editor, 'Title').node.type.name).toBe('heading')
    expect(editor.commands.setHierarchy('S')).toBe(true)
    let out = serializeBody(editor)
    expect(out).toBe('<!-- block: small -->\nTitle line\n\nBody text.\n')
    expect(editor.commands.setHierarchy('Base')).toBe(true)
    expect(serializeBody(editor)).toBe('Title line\n\nBody text.\n')

    cursorIn(editor, 'Body')
    expect(editor.commands.setListType('roman')).toBe(true)
    expect(all(editor, 'orderedList')).toHaveLength(1)
    expect(serializeBody(editor)).toBe('Title line\n\n<!-- block: list=roman -->\n1. Body text.\n')
    expect(editor.commands.setListType('numerical')).toBe(true)
    expect(serializeBody(editor)).toBe('Title line\n\n1. Body text.\n')
    expect(editor.commands.setListType('bullet')).toBe(true)
    expect(all(editor, 'bulletList')).toHaveLength(1)
    expect(editor.commands.setListType(null)).toBe(true)
    expect(serializeBody(editor)).toBe('Title line\n\nBody text.\n')

    // Toggle and group wrap and unwrap; options of the container through the selection.
    cursorIn(editor, 'Body')
    editor.commands.wrapInToggle()
    expect(all(editor, 'toggle')).toHaveLength(1)
    cursorIn(editor, 'Body')
    expect(editor.commands.setBlockOption('open', null)).toBe(true)
    expect(serializeBody(editor)).toBe('Title line\n\n<!-- toggle -->\nBody text.\n<!-- /toggle -->\n')
    expect(editor.commands.unwrapToggle()).toBe(true)
    expect(serializeBody(editor)).toBe('Title line\n\nBody text.\n')
    cursorIn(editor, 'Body')
    editor.commands.wrapInGroup()
    cursorIn(editor, 'Body')
    editor.commands.setBlockOption('color', 'bg-yellow', all(editor, 'group')[0].pos)
    expect(serializeBody(editor)).toBe('Title line\n\n<!-- group color=bg-yellow -->\nBody text.\n<!-- /group -->\n')
    expect(editor.commands.unwrapGroup()).toBe(true)
    expect(all(editor, 'group')).toHaveLength(0)

    // Columns, widths and layout.
    cursorIn(editor, 'Title')
    editor.commands.insertColumns(3)
    const cols = all(editor, 'columns')[0]
    expect(cols.node.childCount).toBe(3)
    editor.commands.setColumnWidths(cols.pos, [20, 30, 50])
    editor.commands.setBlockOption('layout', 'grid', all(editor, 'columns')[0].pos)
    out = serializeBody(editor)
    expect(out).toContain('<!-- columns widths=20,30,50 layout=grid -->\n<!-- column -->\n<!-- column -->\n<!-- /columns -->')
    editor.commands.setColumnWidths(all(editor, 'columns')[0].pos, null)
    expect(serializeBody(editor)).toContain('<!-- columns layout=grid -->\n')

    // Every new leaf block.
    const fresh = headless('')
    fresh.commands.insertMedia({ form: 'wiki', target: 'Attachments/report.pdf' })
    expect(all(fresh, 'media')[0].node.attrs.kind).toBe('pdf')
    fresh.commands.setTextSelection(fresh.state.doc.content.size)
    fresh.commands.insertMedia({ form: 'md', src: 'Attachments/a.png', alt: 'a' })
    fresh.commands.insertObjectEmbed('Ada Lovelace')
    fresh.commands.insertMathBlock()
    fresh.commands.insertBookmark('https://example.com')
    expect(serializeBody(fresh)).toBe(
      [
        '![[Attachments/report.pdf]]',
        '![a](Attachments/a.png)',
        '![[Ada Lovelace]]',
        '$$\n\n$$',
        '<!-- block: bookmark -->\n[https://example.com](https://example.com)',
      ].join('\n\n'),
    )
    const para = headless('Sum: \n')
    para.commands.setTextSelection(blockWith(para, 'Sum').node.nodeSize - 1)
    para.commands.insertInlineMath('x+y')
    expect(serializeBody(para)).toBe('Sum: $x+y$\n')
    // Task 11: pickMedia opens the file dialog (a hidden input); pickObjectEmbed needs an installed picker.
    expect(para.commands.pickMedia('image')).toBe(true)
    document.querySelector('input[data-media-picker]')?.remove()
    expect(para.commands.pickObjectEmbed()).toBe(false)
  })
})

describe('M7 review fixes', () => {
  const types = (editor: TiptapEditor) => {
    const out: string[] = []
    editor.state.doc.forEach((n) => out.push(n.type.name))
    return out
  }

  test('replacing the last block keeps the final newline (LF and CRLF)', () => {
    const editor = headless('Hello world\n')
    cursorIn(editor, 'Hello')
    editor.commands.toggleBulletList()
    expect(serializeBody(editor)).toBe('- Hello world\n')
    const crlf = headless('Intro\r\n\r\nHello world\r\n')
    cursorIn(crlf, 'Hello')
    crlf.commands.toggleBulletList()
    expect(serializeBody(crlf)).toBe('Intro\r\n\r\n- Hello world\r\n')
  })

  test('adding a block after the last one keeps the final newline; none stays none', () => {
    const editor = headless('Hello world\n')
    editor.commands.insertContentAt(editor.state.doc.content.size, { type: 'paragraph', content: [{ type: 'text', text: 'More' }] })
    expect(serializeBody(editor)).toBe('Hello world\n\nMore\n')
    const bare = headless('Hello world')
    bare.commands.insertContentAt(bare.state.doc.content.size, { type: 'paragraph', content: [{ type: 'text', text: 'More' }] })
    expect(serializeBody(bare)).toBe('Hello world\n\nMore')
    const last = headless('One\n\nTwo')
    cursorIn(last, 'Two')
    last.commands.toggleBulletList()
    expect(serializeBody(last)).toBe('One\n\n- Two')
  })

  test('Turn Into drops options that no longer apply: aligned paragraph -> code', () => {
    const editor = headless('Before\n\n<!-- block: align=center x-note=1 -->\nCentered\n\nAfter\n')
    cursorIn(editor, 'Centered')
    expect(turnInto(editor, 'code')).toBe(true)
    const out = serializeBody(editor)
    expect(out).not.toContain('align=center')
    expect(out).toContain('<!-- block: x-note=1 -->')
    const reloaded = headless(out)
    expect(types(reloaded)).toEqual(['paragraph', 'codeBlock', 'paragraph'])
  })

  test('Turn Into drops options that no longer apply: wrapped code -> text', () => {
    const editor = headless('Before\n\n<!-- block: wrap -->\n```\ncode line\n```\n\nAfter\n')
    cursorIn(editor, 'code line')
    expect(turnInto(editor, 'text')).toBe(true)
    const out = serializeBody(editor)
    expect(out).not.toContain('<!--')
    const reloaded = headless(out)
    expect(types(reloaded)).toEqual(['paragraph', 'paragraph', 'paragraph'])
    expect(all(reloaded, 'rawBlock')).toHaveLength(0)
  })

  test('an edited block keeps options as read when its type did not change', () => {
    const editor = headless('<!-- block: align=center -->\nCentered\n')
    typeAtEndOf(editor, 'Centered', '!')
    expect(serializeBody(editor)).toBe('<!-- block: align=center -->\nCentered!\n')
  })

  test('unwrapping a toggle keeps the blank line after it', () => {
    const body = '<!-- toggle open -->\nT\nchild\n<!-- /toggle -->\n\nafter\n'
    const editor = headless(body)
    cursorIn(editor, 'child')
    expect(editor.commands.unwrapToggle()).toBe(true)
    const out = serializeBody(editor)
    expect(out).toBe('T\nchild\n\nafter\n')
    const reloaded = headless(out)
    expect(blockWith(reloaded, 'after').node.textContent).toBe('after')
  })
  // Known issue 6: a lazy continuation line (CommonMark) after a to-do loaded as one raw block.
  describe('lazy continuation lines', () => {
    const TOGGLE =
      '<!-- toggle open -->\n### Server checklist\n- [ ] Patch the hosts\nDetails in [[Embedded target]].\n<!-- /toggle -->\n\nAfter.\n'

    test('a to-do with a lazy line inside an open toggle loads as a to-do, and round trips', () => {
      for (const body of [TOGGLE, EVERY]) {
        const editor = headless(body)
        expect(all(editor, 'rawBlock').map((r) => r.node.textContent)).not.toContainEqual(
          expect.stringContaining('Patch the hosts'),
        )
        const toggle = all(editor, 'toggle').find((t) => t.node.textContent.includes('Patch the hosts'))!
        expect(toggle.node.childCount).toBe(2)
        const list = toggle.node.child(1)
        expect(list.type.name).toBe('taskList')
        expect(list.childCount).toBe(1)
        const item = list.firstChild!
        expect(item.attrs.checked).toBe(false)
        expect(item.childCount).toBe(1)
        expect(item.firstChild!.type.name).toBe('paragraph')
        expect(item.firstChild!.textContent).toMatch(/^Patch the hosts\nDetails in /)
        expect(serializeBody(editor)).toBe(body)
      }
      const editor = headless(TOGGLE)
      expect(all(editor, 'wikilink').map((w) => w.node.attrs.target)).toEqual(['Embedded target'])
    })

    test('the lazy line is part of the paragraph in a to-do, a list and a quote at the top level', () => {
      const cases: [string, string][] = [
        ['- [x] Done item\nlazy line.\n', 'taskList'],
        ['- [ ] One\n- [ ] Two\nlazy two.\n', 'taskList'],
        ['- Bullet item\nlazy line.\n', 'bulletList'],
        ['1. Numbered item\nlazy line.\n', 'orderedList'],
        ['> Quoted text\nlazy line.\n', 'blockquote'],
      ]
      for (const [body, type] of cases) {
        const editor = headless(body)
        expect(editor.state.doc.firstChild!.type.name, body).toBe(type)
        expect(all(editor, 'rawBlock'), body).toHaveLength(0)
        expect(all(editor, 'paragraph').some((p) => p.node.textContent.endsWith('\nlazy line.') || p.node.textContent.endsWith('\nlazy two.')), body).toBe(true)
        expect(serializeBody(editor), body).toBe(body)
      }
    })

    test('a to-do keeps its nested content and the blank line after it', () => {
      const body = '- [ ] Parent\n  continued\n  - [x] Child\n- [ ] Sibling\n\nAfter.\n'
      const editor = headless(body)
      const list = editor.state.doc.firstChild!
      expect(list.type.name).toBe('taskList')
      expect(list.childCount).toBe(2)
      expect(list.firstChild!.firstChild!.textContent).toBe('Parent\ncontinued')
      expect(list.firstChild!.child(1).type.name).toBe('taskList')
      expect(list.firstChild!.child(1).firstChild!.attrs.checked).toBe(true)
      expect(serializeBody(editor)).toBe(body)
    })

    test('editing elsewhere leaves the toggle with the lazy line byte-identical', () => {
      const editor = headless(TOGGLE)
      typeAtEndOf(editor, 'After', ' More')
      expect(serializeBody(editor)).toBe(TOGGLE.replace('After.', 'After. More'))
    })
  })
})
