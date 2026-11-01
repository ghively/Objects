import { Editor as TiptapEditor } from '@tiptap/core'
import { afterEach, test } from 'vitest'
import { editorExtensions, loadBody, serializeBody } from './document'
const editors: TiptapEditor[] = []
afterEach(() => { while (editors.length) editors.pop()!.destroy() })
function headless(body: string): TiptapEditor { const e = new TiptapEditor({ extensions: editorExtensions() }); loadBody(e, body); editors.push(e); return e }
function shape(e: TiptapEditor) { const out: string[] = []; e.state.doc.forEach((n) => out.push(n.type.name + ':' + JSON.stringify(n.textContent).slice(0, 50))); return out.join(' | ') }
function endOf(e: TiptapEditor, needle: string): number { let at = -1; e.state.doc.descendants((n, p) => { if (at < 0 && n.isTextblock && n.textContent.includes(needle)) { at = p + 1 + n.content.size; return false } return at < 0 }); return at }
test('tasks', () => {
  for (const b of ['* [ ] a\n* [X] b\n', '- [X] done\n', '- [x] done\n', '1. [ ] a\n2. [x] b\n', '- [ ] a\n- plain\n', '- [ ] a\n\n- [ ] b\n', '- [ ]   a\n', '- [ ] a\n  more\n', '+ [ ] a\n', '- [x]  \n']) {
    const e = headless(b); console.log(JSON.stringify(b), '->', shape(e), 'noedit identical:', serializeBody(e) === b)
  }
  const e4 = headless('- [ ] a\n- plain\n'); e4.view.dispatch(e4.state.tr.insertText('Z', endOf(e4, 'plain'))); console.log('mixed list edit:', JSON.stringify(serializeBody(e4)), shape(headless(serializeBody(e4))))
  const e5 = headless('- [ ] a\n- [x] b\n'); let pos = -1; e5.state.doc.descendants((n, p) => { if (pos < 0 && n.type.name === 'taskItem' && n.textContent.startsWith('b')) pos = p; return pos < 0 }); e5.view.dispatch(e5.state.tr.setNodeAttribute(pos, 'checked', false)); console.log('uncheck b:', JSON.stringify(serializeBody(e5)))
})
