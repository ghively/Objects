import fs from 'node:fs'
import { Editor as TiptapEditor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { test } from 'vitest'
import { editorExtensions, loadBody, serializeBody } from './document'
const J = JSON.stringify
const out = (s: string) => fs.appendFileSync(process.env.OUT!, s + '\n')
function headless(body: string) { const e = new TiptapEditor({ extensions: editorExtensions() }); loadBody(e, body); return e }
function desc(e: TiptapEditor) { return J(e.getJSON().content?.map((n) => [n.type, n.attrs?.start, n.content?.map((c: any) => c.text ?? c.type)])).slice(0, 300) }
function find(e: TiptapEditor, needle: string, type?: string) {
  let r: { pos: number; node: any } | null = null
  e.state.doc.descendants((n, p) => { if (!r && (type ? n.type.name === type && n.textContent.includes(needle) : n.isTextblock && n.textContent.includes(needle))) { r = { pos: p, node: n }; return false } return !r })
  if (!r) throw new Error('no ' + needle); return r as { pos: number; node: any }
}
function run(name: string, body: string, op: (e: TiptapEditor) => void) {
  const e = headless(body)
  try { op(e) } catch (err) { out(`${name}: OP ERROR ${err}`); return }
  const s = serializeBody(e)
  const e2 = headless(s)
  out(`${name}:\n  in   ${J(body)}\n  out  ${J(s)}\n  e1   ${desc(e)}\n  e2   ${desc(e2)}`)
  e.destroy(); e2.destroy()
}
const delNode = (needle: string, type: string) => (e: TiptapEditor) => { const f = find(e, needle, type); e.view.dispatch(e.state.tr.delete(f.pos, f.pos + f.node.nodeSize)) }
const append = (needle: string, t: string) => (e: TiptapEditor) => { const f = find(e, needle); e.view.dispatch(e.state.tr.insertText(t, f.pos + f.node.nodeSize - 1)) }
test('ops', () => {
  const tests = (await_import())
  for (const [n, b, o] of tests) run(n, b, o)
})
function await_import(): [string, string, (e: TiptapEditor) => void][] {
  return [
    ['ol delete first', '1. a\n2. b\n3. c\n', delNode('a', 'listItem')],
    ['ol delete first (start 5)', '5. a\n6. b\n', delNode('a', 'listItem')],
    ['ol move/insert', '1. a\n2. b\n', append('a', 'X')],
    ['ul delete nested parent', '- a\n  - b\n- c\n', delNode('a', 'listItem')],
    ['table add pipe text', '| a | b |\n|---|---|\n| x | y |\n', append('y', ' p|q')],
    ['table edit escaped pipe cell', '| a | b |\n|---|---|\n| x \\| y | z |\n', append('x', 'W')],
    ['code with fence inside edited', '```\nfoo\n```\n', (e) => { const f = find(e, 'foo'); e.view.dispatch(e.state.tr.insertText('\n```\nbar', f.pos + f.node.nodeSize - 1)) }],
    ['new code block with fence', 'Para\n', (e) => { e.commands.setContent ? null : null; const s = e.schema; e.view.dispatch(e.state.tr.replaceWith(0, e.state.doc.content.size, s.nodes.codeBlock.create({ language: 'js' }, s.text('a\n```\nb')))) }],
    ['math edit with $$', '$$\nx\n$$\n', (e) => { const f = find(e, '', 'mathBlock') }],
    ['multiline para edit 2nd line', '*em* line one\nline _two_\n', append('two', 'X')],
    ['crlf para edit', 'Para one\r\n\r\nPara two\r\n', append('two', 'X')],
    ['crlf list edit add item', '- a\r\n- b\r\n', (e) => { const f = find(e, 'b', 'listItem'); e.view.dispatch(e.state.tr.insert(f.pos + f.node.nodeSize, e.schema.nodes.listItem.create(null, e.schema.nodes.paragraph.create(null, e.schema.text('c'))))) }],
    ['bom first para edit', '﻿Hello\n', append('Hello', 'X')],
    ['trailing ws para edit', 'Hello   \n', append('Hello', 'X')],
    ['heading closing hashes', '## Title ##\n', append('Title', 'X')],
    ['setext heading', 'Title\n=====\n', append('Title', 'X')],
    ['task list edit', '- [ ] a\n- [x] b\n', append('a', 'X')],
    ['list lazy continuation edit', '- a\nlazy\n- b\n', append('b', 'X')],
    ['blockquote multi edit', '> a\n> b\n', append('b', 'X')],
    ['quote containing list edit', '> - a\n> - b\n', append('b', 'X')],
    ['loose list edit', '- a\n\n- b\n', append('b', 'X')],
    ['list with para continuation', '- a\n\n  more\n- b\n', append('b', 'X')],
    ['ordered list 1) edit', '1) a\n2) b\n', append('b', 'X')],
    ['footnote ref', 'See[^1] x\n\n[^1]: note\n', append('x', 'Y')],
    ['html inline para', 'a <kbd>K</kbd> b\n', append('b', 'X')],
    ['color span edit', 'a <span data-color="text-red">red</span> b\n', append('b', 'X')],
    ['wikilink with ] in title', '[[a]b]] x\n', append('x', 'Y')],
    ['wikilink pipe empty label', '[[a|]] x\n', append('x', 'Y')],
    ['block id para edit', 'Hello ^abc123\n', append('abc123', 'X')],
    ['inline math edit', 'a $x_1$ b\n', append('b', 'X')],
    ['autolink edit', 'see <https://a.b> x\n', append('x', 'Y')],
    ['bare url edit', 'see https://a.b/c_d_e x\n', append('x', 'Y')],
    ['nested emphasis', '***bi*** x\n', append('x', 'Y')],
    ['underscore emph', '_em_ and __strong__ x\n', append('x', 'Y')],
    ['image with title edit next', '![a](b.png "t")\n\nP\n', append('P', 'X')],
    ['link with title', '[a](http://x "T") x\n', append('x', 'Y')],
    ['ref link', '[a][r] x\n\n[r]: http://x\n', append('x', 'Y')],
    ['entity nbsp', 'a&nbsp;b x\n', append('x', 'Y')],
    ['hard break backslash in list', '- a\\\n  b\n', append('b', 'X')],
    ['code span double backtick', 'a `` b`c `` x\n', append('x', 'Y')],
    ['strike', '~~s~~ x\n', append('x', 'Y')],
    ['highlight mark', '<mark>h</mark> x\n', append('x', 'Y')],
    ['indented code', '    code\n    more\n', append('more', 'X')],
    ['table alignment', '| a | b |\n|:--|--:|\n| x | y |\n', append('y', 'Z')],
    ['table no outer pipes', 'a | b\n--|--\nx | y\n', append('y', 'Z')],
    ['table inline code pipe', '| a | b |\n|---|---|\n| `x\\|y` | z |\n', append('z', 'Z')],
  ]
}
