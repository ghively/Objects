import fs from 'node:fs'
import { Editor as TiptapEditor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { test } from 'vitest'
import { moveBlockTo } from './handles/dragMove'
import { moveBlocks } from './extensions/blockSelection'
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
    ['soft->hard break', 'aaa\nbbb\n\nP\n', (e) => { const f = find(e, 'aaa'); const p = f.pos + 4; e.view.dispatch(e.state.tr.replaceWith(p, p + 1, e.schema.nodes.hardBreak.create())) }],
    ['code trailing ws edit', '```\nx\ny\n```\n', (e) => { const f = find(e, 'x'); e.view.dispatch(e.state.tr.insertText('   ', f.pos + 2)) }],
    ['code trailing ws only line', '```py\nif a:\n    pass\n```\n', (e) => { const f = find(e, 'pass'); e.view.dispatch(e.state.tr.insertText('  ', f.pos + 1 + 'if a:'.length)) }],
  ]
}
