import fs from 'node:fs'
import { Editor as TiptapEditor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { test } from 'vitest'
import { editorExtensions, loadBody, serializeBody } from './document'
const J = JSON.stringify
function headless(body: string) { const e = new TiptapEditor({ extensions: editorExtensions() }); loadBody(e, body); return e }
function desc(e: TiptapEditor) { return J(e.getJSON().content?.map((n) => [n.type, n.content?.map((c: any) => c.text ?? c.type)])).slice(0, 200) }
test('typed', () => {
  const texts: string[] = JSON.parse(fs.readFileSync(process.env.CASES!, 'utf8'))
  for (const t of texts) {
    const e = headless('Para\n')
    // type into the paragraph: replace text with t
    e.view.dispatch(e.state.tr.insertText(t, 1, 5))
    const s = serializeBody(e)
    const e2 = headless(s)
    const same = J(e.getJSON().content?.[0]) === J({ ...e2.getJSON().content?.[0] })
    fs.appendFileSync(process.env.OUT!, `${J(t)} -> ${J(s)} -> ${desc(e2)}\n`)
    e.destroy(); e2.destroy()
  }
})
