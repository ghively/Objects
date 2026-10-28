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
  const top = (e: TiptapEditor, i: number) => { let p = 0; for (let k = 0; k < i; k++) p += e.state.doc.child(k).nodeSize; return p }
  const join = (i: number) => (e: TiptapEditor) => { e.view.dispatch(e.state.tr.join(top(e, i))) }
  const split = (needle: string, off: number) => (e: TiptapEditor) => { const f = find(e, needle); e.view.dispatch(e.state.tr.split(f.pos + 1 + off)) }
  const move = (from: number, to: number) => (e: TiptapEditor) => { const n = e.state.doc.child(from); const p = top(e, from); let tr = e.state.tr.delete(p, p + n.nodeSize); const q = (() => { let s = 0; for (let k = 0; k < to; k++) s += tr.doc.child(k).nodeSize; return s })(); tr = tr.insert(q, n); e.view.dispatch(tr) }
  return [
    ['join paras', 'A\n\nB\n\nC\n', join(1)],
    ['join heading-para adjacent', '# H\nP\n\nQ\n', join(1)],
    ['split para', 'Hello world\n\nNext\n', split('Hello', 5)],
    ['split heading', '# Hello world\nNext\n', split('Hello', 5)],
    ['move last to first', 'A\n\nB\n\nC\n', move(2, 0)],
    ['move first to last no final nl', 'A\n\nB\n\nC', move(0, 2)],
    ['move heading-adjacent', '# H\nP\n\nQ\n', move(0, 2)],
    ['move CRLF', 'A\r\n\r\nB\r\n', move(1, 0)],
    ['move into blank-separated 3 blank lines', 'A\n\n\n\nB\n', move(1, 0)],
  ]
}
