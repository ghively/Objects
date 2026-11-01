import { Editor as TiptapEditor } from '@tiptap/core'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import { afterEach, test } from 'vitest'
import { editorExtensions, loadBody, serializeBody } from './document'
import { splitBlocks } from './blocks'
import { buildTree } from './blockTree'
import { makeBigBody } from './__fixtures__/bigBody'
const editors: TiptapEditor[] = []
afterEach(() => { while (editors.length) editors.pop()!.destroy() })
function headless(body: string): TiptapEditor { const e = new TiptapEditor({ extensions: editorExtensions() }); loadBody(e, body); editors.push(e); return e }
function shape(e: TiptapEditor) { const out: string[] = []; e.state.doc.forEach((n) => out.push(n.type.name + ':' + JSON.stringify(n.textContent).slice(0, 50))); return out.join(' | ') }
const ms = (t: number) => (performance.now() - t).toFixed(0)

test('1MB breakdown', () => {
  const body = makeBigBody()
  const e = new TiptapEditor({ extensions: editorExtensions() }); editors.push(e)
  let t = performance.now(); const blocks = splitBlocks(body); console.log('splitBlocks', ms(t), 'blocks', blocks.length)
  t = performance.now(); buildTree(blocks); console.log('buildTree', ms(t))
  const md = e.markdown!
  const sample = blocks.filter((b) => b.kind === 'table')
  t = performance.now(); const parsed = sample.map((b) => md.parse(b.raw)); console.log('md.parse all tables', ms(t))
  t = performance.now(); parsed.forEach((p) => md.serialize({ type: 'doc', content: [p.content![0]] })); console.log('md.serialize all tables', ms(t))
  t = performance.now(); parsed.forEach((p) => e.schema.nodeFromJSON(p.content![0]).check()); console.log('nodeFromJSON+check all tables', ms(t))
  // dispatch vs apply
  const doc = e.schema.nodeFromJSON({ type: 'doc', content: parsed.map((p) => p.content![0]) })
  t = performance.now(); const st = e.state.apply(e.state.tr.replaceWith(0, e.state.doc.content.size, doc.content).setMeta('addToHistory', false).setMeta('preventUpdate', true)); console.log('state.apply load (plugins only)', ms(t))
  t = performance.now(); e.view.updateState(st); console.log('view.updateState load (DOM)', ms(t))
  // keystroke cost: plugins only vs with DOM
  const mid = Math.floor(e.state.doc.content.size / 2); const pos = TextSelection.near(e.state.doc.resolve(mid)).from
  t = performance.now(); const st2 = e.state.apply(e.state.tr.insertText('Z', pos)); console.log('state.apply keystroke (plugins only)', ms(t))
  t = performance.now(); e.view.updateState(st2); console.log('view.updateState keystroke (DOM)', ms(t))
  t = performance.now(); e.state.apply(e.state.tr.insertText('Z', pos)); console.log('state.apply keystroke again', ms(t))
  // per-plugin
  const plugins = e.state.plugins
  for (const p of plugins) {
    const key = (p as any).key as string
    const base = EditorState.create({ schema: e.schema, doc: e.state.doc, plugins: [p] })
    const t0 = performance.now()
    try { base.apply(base.tr.insertText('Z', pos)) } catch (err) { console.log(key, 'threw', String(err).slice(0, 80)); continue }
    const d = performance.now() - t0
    if (d > 5) console.log('plugin', key, ms(t0))
  }
}, 300000)

test('paste', () => {
  ;(globalThis as any).ClipboardEvent ??= class ClipboardEvent extends Event { clipboardData: any; constructor(type: string, init?: any) { super(type, init); this.clipboardData = init?.clipboardData ?? null } }
  const cases: [string, string, 'text' | 'html', number | null][] = [
    ['markdown blocks', '- one\n- two\n\n# Head\n\n| a | b |\n|---|---|\n| 1 | 2 |\n', 'text', null],
    ['html blocks', '<ul><li>one</li><li>two</li></ul><h1>Head</h1><p>para <b>bold</b></p>', 'html', null],
    ['plain multi into middle', 'line1\nline2\n\npara2', 'text', 7],
    ['md chars inline', 'see https://x.y/a_b and *not bold* and # not heading', 'text', 7],
    ['wikilinks', '[[Page]] and [[Other|label]]', 'text', null],
    ['annotations', '<!-- block: align=center -->\nCentered\n\n<!-- toggle -->\nhead\n<!-- /toggle -->', 'text', null],
    ['fence', '```js\ncode\n```', 'text', null],
    ['own copy of a list (text/plain)', '- a\n- b\n', 'text', null],
    ['indented', '    code?', 'text', null],
    ['field', 'Key:: value', 'text', null],
  ]
  for (const [name, text, kind, at] of cases) {
    const e = headless('Hello world\n\nb\n')
    e.view.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, at ?? e.state.doc.content.size - 1)))
    if (kind === 'text') e.view.pasteText(text); else e.view.pasteHTML(text)
    const saved = serializeBody(e)
    console.log(`paste ${name}:\n  shape: ${shape(e)}\n  saved: ${JSON.stringify(saved)}\n  reload: ${shape(headless(saved))}`)
  }
})
