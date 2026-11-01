import { Editor as TiptapEditor } from '@tiptap/core'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import { afterEach, test } from 'vitest'
import { editorExtensions, loadBody } from './document'
import { makeBigBody } from './__fixtures__/bigBody'
const editors: TiptapEditor[] = []
afterEach(() => { while (editors.length) editors.pop()!.destroy() })
test('per plugin', () => {
  const body = makeBigBody()
  const e = new TiptapEditor({ extensions: editorExtensions() }); editors.push(e)
  loadBody(e, body)
  const mid = Math.floor(e.state.doc.content.size / 2); const pos = TextSelection.near(e.state.doc.resolve(mid)).from
  const none = EditorState.create({ schema: e.schema, doc: e.state.doc, plugins: [] })
  let t0 = performance.now(); for (let i = 0; i < 5; i++) none.apply(none.tr.insertText('Z', pos)); console.log('no plugins x5', (performance.now() - t0).toFixed(1))
  const rows: [string, number][] = []
  for (const p of e.state.plugins) {
    const key = (p as any).key as string
    const base = EditorState.create({ schema: e.schema, doc: e.state.doc, plugins: [p] })
    const t = performance.now()
    try { for (let i = 0; i < 5; i++) base.apply(base.tr.insertText('Z', pos)) } catch (err) { rows.push([key + ' THREW ' + String(err).slice(0, 60), 0]); continue }
    rows.push([key, (performance.now() - t) / 5])
  }
  rows.sort((a, b) => b[1] - a[1])
  console.log(rows.slice(0, 15).map(([k, d]) => `${k}: ${d.toFixed(1)}ms`).join('\n'))
  t0 = performance.now(); for (let i = 0; i < 5; i++) e.state.apply(e.state.tr.insertText('Z', pos)); console.log('all plugins x5 avg', ((performance.now() - t0) / 5).toFixed(1))
}, 300000)
