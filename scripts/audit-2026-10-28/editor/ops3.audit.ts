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
  return [
    ['table cell hardbreak', '| a | b |\n|---|---|\n| x | y |\n', (e) => { const f = find(e, 'y'); e.view.dispatch(e.state.tr.insert(f.pos + f.node.nodeSize - 1, [e.schema.nodes.hardBreak.create(), e.schema.text('z')])) }],
    ['table add row aligned', '| a   | b   |\n| --- | --- |\n| x   | y   |\n', (e) => { sel('y')(e); (e.commands as any).addRowAfter(); }],
    ['heading trailing hash', '## Title\n', append('Title', ' #')],
    ['plain dollars typed', 'Para\n', (e) => e.view.dispatch(e.state.tr.insertText('a $b$ c', 1, 5))],
    ['list item code block', '- a\n\n  ```\n  x\n  ```\n- b\n', append('b', 'X')],
    ['list item 2-space nested edit', '- a\n  - b\n  - c\n- d\n', append('c', 'X')],
    ['ordered nested under bullet', '- a\n   1. b\n   2. c\n', append('c', 'X')],
    ['tab indented nested', '- a\n\t- b\n', append('b', 'X')],
    ['blockquote lazy', '> a\nb\n', append('b', 'X')],
    ['standout quote', '<!-- block: quote=standout -->\n> q\n', append('q', 'X')],
    ['heading with emoji icon annot', '<!-- block: icon=ph-star -->\n## H\n', append('H', 'X')],
    ['para trailing backslash', 'end with \\\\\n', append('end', 'X')],
    ['para with html comment inline', 'a <!-- c --> b\n', append('b', 'X')],
    ['two spaces hard break edit line1', 'one  \ntwo\n', append('one', 'X')],
    ['numbers para', '2024. was good\n', append('good', 'X')],
  ]
}
