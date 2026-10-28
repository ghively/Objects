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
    ['field line std::', 'Use std::vector here\n', append('here', 'X')],
    ['list with ::', '- a::b\n- c\n', append('c', 'X')],
    ['bare url only', 'see https://a.b x\n', append('x', 'Y')],
    ['plain url para', 'https://example.com\n', append('com', 'Y')],
    ['escaped hash', '\\# not heading\n', append('heading', 'X')],
    ['escaped dash', '\\- not list\n', append('list', 'X')],
    ['escaped gt', '\\> not quote\n', append('quote', 'X')],
    ['wrap list in toggle', '- a\n- b\n\nP\n', wrapT('a', 'wrapInToggle')],
    ['wrap para in toggle', 'A\nB line\n\nP\n', wrapT('A', 'wrapInToggle')],
    ['wrap list in group', '- a\n- b\n\nP\n', wrapT('a', 'wrapInGroup')],
    ['wrap code in toggle', '```\nx\n```\n\nP\n', wrapT('x', 'wrapInToggle')],
    ['wrap table in toggle', '| a |\n|---|\n| b |\n\nP\n', wrapT('b', 'wrapInToggle')],
    ['edit inside toggle', '<!-- toggle open -->\nHead\n- a\n<!-- /toggle -->\n', append('a', 'X')],
    ['edit inside columns', '<!-- columns -->\nL\n<!-- column -->\nR\n<!-- /columns -->\n', append('R', 'X')],
    ['insert columns', 'P\n', (e) => { sel('P')(e); (e.commands as any).insertColumns(2) }],
    ['toggle in list item text', '- <!-- toggle -->\n', append('toggle', 'X')],
    ['annotation then edit block type', '<!-- block: color=bg-blue -->\n# H\n', append('H', 'X')],
    ['annot unknown opt', '<!-- block: foo=bar -->\nP\n', append('P', 'X')],
    ['comment line in para', 'a\n<!-- note -->\nb\n', append('b', 'X')],
  ]
}
