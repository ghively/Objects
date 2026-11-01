import { Editor as TiptapEditor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { afterEach, test } from 'vitest'
import { editorExtensions, loadBody, serializeBody } from './document'
const editors: TiptapEditor[] = []
afterEach(() => { while (editors.length) editors.pop()!.destroy() })
function headless(body: string): TiptapEditor { const e = new TiptapEditor({ extensions: editorExtensions() }); loadBody(e, body); editors.push(e); return e }
function atoms(e: TiptapEditor) { const out: string[] = []; e.state.doc.descendants((n) => { if (n.type.name === 'wikilink' || n.type.name === 'inlineMath' || n.type.name === 'dateToken') out.push(n.type.name + JSON.stringify(n.attrs)); return true }); return out.join(' ; ') }
function endOf(e: TiptapEditor, needle: string): number { let at = -1; e.state.doc.descendants((n, p) => { if (at < 0 && n.isTextblock && n.textContent.includes(needle)) { at = p + 1 + n.content.size; return false } return at < 0 }); return at }
test('pipe in atoms inside table cells', () => {
  let e = headless('| a | b |\n|---|---|\n| x | y |\n')
  e.view.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, endOf(e, 'y'))))
  e.commands.insertContent({ type: 'wikilink', attrs: { target: 'P', label: 'lab' } })
  const saved = serializeBody(e); const e2 = headless(saved)
  console.log('wikilink label in cell: saved', JSON.stringify(saved), '\n  before:', atoms(e), '\n  after reload:', atoms(e2), '\n  resaved:', JSON.stringify(serializeBody(e2)))
  e = headless('| a | b |\n|---|---|\n| x | y |\n')
  e.view.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, endOf(e, 'y'))))
  e.commands.insertContent({ type: 'inlineMath', attrs: { text: 'a|b' } })
  const s2 = serializeBody(e); const e3 = headless(s2)
  console.log('inline math pipe in cell: saved', JSON.stringify(s2), '\n  before:', atoms(e), '\n  after reload:', atoms(e3), '\n  resaved:', JSON.stringify(serializeBody(e3)))
  // a file already containing the GFM-correct escaped form
  for (const body of ['| a | b |\n|---|---|\n| [[P\\|lab]] | y |\n', '| a | b |\n|---|---|\n| $a\\|b$ | y |\n', '| a | b |\n|---|---|\n| `c\\|d` | y |\n', '| a | b |\n|---|---|\n| [l](http://x/a\\|b) | y |\n']) {
    const ed = headless(body)
    console.log('load', JSON.stringify(body), '->', atoms(ed) || ed.state.doc.firstChild!.type.name, JSON.stringify(ed.state.doc.firstChild!.textContent), 'noedit save identical:', serializeBody(ed) === body)
  }
})
test('wikilink with pipe in a paragraph', () => {
  const e = headless('x\n')
  e.view.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, 2)))
  e.commands.insertContent({ type: 'wikilink', attrs: { target: 'A|B', label: null } })
  const saved = serializeBody(e); const e2 = headless(saved)
  console.log('target with pipe: saved', JSON.stringify(saved), 'reload:', atoms(e2))
  const e3 = headless('x\n'); e3.view.dispatch(e3.state.tr.setSelection(TextSelection.create(e3.state.doc, 2)))
  e3.commands.insertContent({ type: 'wikilink', attrs: { target: 'A]]B', label: null } })
  const s3 = serializeBody(e3); console.log('target with ]]: saved', JSON.stringify(s3), 'reload:', atoms(headless(s3)), JSON.stringify(headless(s3).state.doc.textContent))
})
