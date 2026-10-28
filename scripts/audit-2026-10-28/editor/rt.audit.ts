import fs from 'node:fs'
import { Editor as TiptapEditor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { test } from 'vitest'
import { editorExtensions, loadBody, serializeBody } from './document'

function headless(body: string) {
  const editor = new TiptapEditor({ extensions: editorExtensions() })
  loadBody(editor, body)
  return editor
}
function types(e: TiptapEditor) { const t: string[] = []; e.state.doc.forEach((n) => t.push(n.type.name)); return t.join(',') }
/** append text at end of the first textblock containing `needle` */
function typeAt(e: TiptapEditor, needle: string, text: string) {
  let pos = -1
  e.state.doc.descendants((n, p) => { if (pos < 0 && n.isTextblock && n.textContent.includes(needle)) { pos = p + n.nodeSize - 1; return false } return pos < 0 })
  if (pos < 0) throw new Error('no ' + needle)
  e.view.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, pos)).insertText(text))
}
const J = JSON.stringify
const CASES: [string, string][] = JSON.parse(fs.readFileSync(process.env.CASES!, 'utf8'))
test('roundtrip probes', () => {
  for (const [body, needle] of CASES) {
    const e = headless(body)
    const t0 = types(e)
    const s0 = serializeBody(e)
    typeAt(e, needle, 'Z')
    const s1 = serializeBody(e)
    const e2 = headless(s1)
    const s2 = serializeBody(e2)
    fs.appendFileSync(process.env.OUT!, ['IN ', J(body), '\n types', t0, ' unedited ok', s0 === body, '\n EDIT', J(s1), '\n reload types', types(e2), J(e2.getJSON().content?.map((n) => n.content?.map((c: any) => c.text ?? c.type))).slice(0, 300)].join(' ') + '\n\n')
    e.destroy(); e2.destroy()
  }
})
