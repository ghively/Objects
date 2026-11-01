import { Editor as TiptapEditor } from '@tiptap/core'
import { afterEach, test } from 'vitest'
import { editorExtensions, loadBody, serializeBody } from './document'
const editors: TiptapEditor[] = []
afterEach(() => { while (editors.length) editors.pop()!.destroy() })
function headless(body: string): TiptapEditor { const e = new TiptapEditor({ extensions: editorExtensions() }); loadBody(e, body); editors.push(e); return e }
function dump(e: TiptapEditor) { return JSON.stringify(e.state.doc.toJSON().content.map((n: any) => ({ t: n.type, c: (n.content ?? []).map((x: any) => x.type === 'text' ? [x.text, (x.marks ?? []).map((m: any) => m.type + (m.attrs?.href ? ':' + m.attrs.href : ''))] : x.type) }))) }
test('escapes', () => {
  for (const body of ['\\* not a list\n\\# not heading\n', '\\* not a list\n\\# not headingZ\n', '\\* x\n', '\\# x\n', 'a\n\\# b\n', '\\* a\n\\* b\n']) {
    const e = headless(body)
    console.log(JSON.stringify(body), '=>', dump(e), 'md.parse:', JSON.stringify(e.markdown?.parse(body)))
  }
})
test('url star', () => {
  for (const body of ['see https://example.com/a_b_c*d\n', 'see [https://example.com/a\\_b\\_c\\*dZ](https://example.com/a_b_c*d)\n', '[a\\*b](http://x)\n', 'x https://e.com/a*b y\n']) {
    const e = headless(body)
    console.log(JSON.stringify(body), '=>', dump(e), '\n   saved:', JSON.stringify(serializeBody(e)))
    // edit: insert Z at end
    const last = e.state.doc.firstChild!
    e.view.dispatch(e.state.tr.insertText('Z', last.nodeSize - 1))
    console.log('   after Z:', JSON.stringify(serializeBody(e)))
  }
})
