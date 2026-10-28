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
  const sel = (needle: string) => (e: TiptapEditor) => { const f = find(e, needle); e.commands.setTextSelection(f.pos + 1) }
  const wrapT = (needle: string, cmd: string) => (e: TiptapEditor) => { sel(needle)(e); (e.commands as any)[cmd]() }
  const undo = (e: TiptapEditor) => { e.commands.undo() }
  const both = (...fs: ((e: TiptapEditor) => void)[]) => (e: TiptapEditor) => fs.forEach((f) => f(e))
  const newPara = (t: string) => (e: TiptapEditor) => { const end = e.state.doc.content.size; e.view.dispatch(e.state.tr.insert(end, e.schema.nodes.paragraph.create(null, e.schema.text(t)))) }
  return [
    ['undo para edit', '*a*  b\n\n_c_\n', both(append('b', 'X'), undo)],
    ['undo in toggle', '<!-- toggle -->\nH\n<!-- /toggle -->\n\nP\n', both(append('H', 'X'), undo)],
    ['undo delete', '* a\n* b\n\nP  \n', both(delNode('a', 'listItem'), undo)],
    ['no final newline add para', 'A\n\nB', newPara('C')],
    ['crlf add para', 'A\r\n\r\nB\r\n', newPara('C')],
    ['crlf add para in toggle', '<!-- toggle open -->\r\nH\r\n<!-- /toggle -->\r\n', (e) => { const f = find(e, 'H'); e.view.dispatch(e.state.tr.insert(f.pos + f.node.nodeSize, e.schema.nodes.paragraph.create(null, e.schema.text('C')))) }],
    ['crlf multi-line new code', 'A\r\n', (e) => { const end = e.state.doc.content.size; e.view.dispatch(e.state.tr.insert(end, e.schema.nodes.codeBlock.create(null, e.schema.text('x\ny')))) }],
    ['crlf edit multi-line para', 'a\r\nb\r\n', append('b', 'X')],
    ['crlf list add nested', '- a\r\n  - b\r\n', append('b', 'X')],
    ['crlf table edit', '| a |\r\n|---|\r\n| b |\r\n', append('b', 'X')],
    ['crlf code edit', '```\r\nx\r\ny\r\n```\r\n', append('y', 'X')],
    ['crlf code add line', '```\r\nx\r\n```\r\n', append('x', '\nnew')],
  ]
}
