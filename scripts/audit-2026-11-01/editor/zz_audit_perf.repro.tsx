import { Editor as TiptapEditor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { afterEach, test } from 'vitest'
import { editorExtensions, loadBody, serializeBody } from './document'
import { makeBigBody } from './__fixtures__/bigBody'
import { formatAnnotation, parseAnnotation } from './annotations'
const editors: TiptapEditor[] = []
afterEach(() => { while (editors.length) editors.pop()!.destroy() })
function headless(body: string): TiptapEditor { const e = new TiptapEditor({ extensions: editorExtensions() }); loadBody(e, body); editors.push(e); return e }
function shape(e: TiptapEditor) { const out: string[] = []; e.state.doc.forEach((n) => out.push(n.type.name + ':' + JSON.stringify(n.textContent).slice(0, 50))); return out.join(' | ') }

test('1MB timings', () => {
  const body = makeBigBody()
  const e = new TiptapEditor({ extensions: editorExtensions() }); editors.push(e)
  let t = performance.now(); loadBody(e, body); console.log('loadBody ms', (performance.now() - t).toFixed(0), 'blocks', e.state.doc.childCount, 'bytes', body.length)
  t = performance.now(); const out = serializeBody(e); console.log('serializeBody (no edit) ms', (performance.now() - t).toFixed(0), 'identical', out === body)
  const mid = Math.floor(e.state.doc.content.size / 2)
  const $m = e.state.doc.resolve(mid); const pos = $m.parent.isTextblock ? mid : TextSelection.near($m).from
  t = performance.now(); e.view.dispatch(e.state.tr.insertText('Z', pos)); console.log('one keystroke dispatch ms', (performance.now() - t).toFixed(1))
  t = performance.now(); for (let i = 0; i < 20; i++) e.view.dispatch(e.state.tr.insertText('Z', pos + i)); console.log('20 keystrokes ms', (performance.now() - t).toFixed(1))
  t = performance.now(); const out2 = serializeBody(e); console.log('serializeBody (after edit) ms', (performance.now() - t).toFixed(0), out2.length)
  t = performance.now(); e.commands.undo(); console.log('undo ms', (performance.now() - t).toFixed(1))
})

test('paste', () => {
  let e = headless('a\n\nb\n')
  e.view.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, e.state.doc.content.size - 1)))
  e.view.pasteText('- one\n- two\n\n# Head\n\n| a | b |\n|---|---|\n| 1 | 2 |\n')
  console.log('pasteText markdown ->', shape(e), '\n  saved:', JSON.stringify(serializeBody(e)))
  e = headless('a\n\nb\n')
  e.view.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, e.state.doc.content.size - 1)))
  e.view.pasteHTML('<ul><li>one</li><li>two</li></ul><h1>Head</h1><p>para <b>bold</b></p>')
  console.log('pasteHTML ->', shape(e), '\n  saved:', JSON.stringify(serializeBody(e)))
  e = headless('Hello world\n')
  e.view.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, 7)))
  e.view.pasteText('line1\nline2\n\npara2')
  console.log('pasteText plain multi into middle ->', shape(e), '\n  saved:', JSON.stringify(serializeBody(e)))
  e = headless('Hello world\n')
  e.view.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, 7)))
  e.view.pasteText('see https://x.y/a_b and *not bold* and # not heading')
  console.log('pasteText with md chars inline ->', shape(e), '\n  saved:', JSON.stringify(serializeBody(e)))
  e = headless('a\n')
  e.view.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, 2)))
  e.view.pasteText('[[Page]] and [[Other|label]]')
  console.log('pasteText wikilinks ->', shape(e), JSON.stringify(e.state.doc.toJSON().content[0].content.map((n: any) => n.type)), '\n  saved:', JSON.stringify(serializeBody(e)))
  e = headless('a\n')
  e.view.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, 2)))
  e.view.pasteText('<!-- block: align=center -->\nCentered\n\n<!-- toggle -->\nhead\n<!-- /toggle -->')
  console.log('pasteText annotations ->', shape(e), '\n  saved:', JSON.stringify(serializeBody(e)))
  e = headless('a\n')
  e.view.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, 2)))
  e.view.pasteText('```js\ncode\n```')
  console.log('pasteText fence ->', shape(e), '\n  saved:', JSON.stringify(serializeBody(e)))
  e = headless('a\r\n\r\nb\r\n')
  e.view.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, e.state.doc.content.size - 1)))
  e.view.pasteText('- one\n- two')
  console.log('pasteText list into CRLF doc ->', shape(e), '\n  saved:', JSON.stringify(serializeBody(e)))
  e = headless('| a | b |\n|---|---|\n| x \\| y | z |\n')
  let at = -1; e.state.doc.descendants((n, p) => { if (at < 0 && n.isText && n.text === 'z') at = p + 1; return at < 0 })
  e.view.dispatch(e.state.tr.insertText('Q', at))
  console.log('edit cell next to escaped pipe ->', JSON.stringify(serializeBody(e)))
  e = headless('| a | b |\n|---|---|\n| x | y |\n')
  at = -1; e.state.doc.descendants((n, p) => { if (at < 0 && n.isText && n.text === 'y') at = p + 1; return at < 0 })
  e.view.dispatch(e.state.tr.insertText('|', at))
  console.log('type pipe in cell ->', JSON.stringify(serializeBody(e)), shape(headless(serializeBody(e))))
  e = headless('- a\n- b\n')
  at = -1; e.state.doc.descendants((n, p) => { if (at < 0 && n.isText && n.text === 'b') at = p + 1; return at < 0 })
  e.view.dispatch(e.state.tr.insertText('\n', at))
  console.log('newline char typed in list item ->', JSON.stringify(serializeBody(e)), shape(headless(serializeBody(e))))
})

test('annotations pure', () => {
  for (const line of ['<!-- block: caption="a --> b" -->\n', '<!-- block: caption="x=y" -->\n', '<!-- block: caption="say \\"hi\\"" -->\n', '<!-- block: align=center color=red -->\n', '<!-- block: localDataViewInfo={"a":1} -->\n', '<!--block:align=center-->\n', '<!-- block: caption=\'quoted\' -->\n', '<!-- block: zz -->\n']) {
    const p = parseAnnotation(line)
    console.log(JSON.stringify(line), '->', JSON.stringify(p), p ? '=> ' + JSON.stringify(formatAnnotation(p as any)) : '')
  }
})
