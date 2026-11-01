// Perf audit scratch: the Tiptap editor with a 1 MB body: load, serialize (autosave), keystroke.
import { writeFileSync } from 'node:fs'
import { Editor as TiptapEditor } from '@tiptap/core'
import { expect, test, vi } from 'vitest'
vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))
import { editorExtensions, loadBody, serializeBody } from '@/editor/document'
import { makeBigBody } from '@/editor/__fixtures__/bigBody'

const results: string[] = []
const ms = (x: number) => Math.round(x * 10) / 10
const log = (w: string, v: number | string) => results.push(`${w}: ${typeof v === 'number' ? ms(v) : v}`)

function proseBody(targetBytes = 1_000_000): string {
  const parts: string[] = []
  let i = 0
  let size = 0
  while (size < targetBytes) {
    const p = i % 7 === 0 ? `## Section ${i}` : i % 5 === 0 ? `- item ${i} with [[Object ${i}]] and **bold**\n- second item ${i}` : `Paragraph ${i}: lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. #tag${i % 20}`
    parts.push(p)
    size += p.length + 2
    i++
  }
  return parts.join('\n\n')
}

test('perf: 1MB body in the editor', () => {
  for (const [name, body] of [['tables fixture (makeBigBody)', makeBigBody()], ['prose 1MB', proseBody()]] as const) {
    const el = document.createElement('div')
    document.body.appendChild(el)
    const editor = new TiptapEditor({ element: el, extensions: editorExtensions(), content: '' })
    const t0 = performance.now()
    loadBody(editor, body)
    log(`${name}: loadBody ms`, performance.now() - t0)
    log(`${name}: doc nodes`, editor.state.doc.nodeSize)
    log(`${name}: body bytes`, body.length)
    const t1 = performance.now()
    const out = serializeBody(editor)
    log(`${name}: serializeBody (unedited, autosave path) ms`, performance.now() - t1)
    log(`${name}: roundtrip equal`, String(out === body))
    // A keystroke in the first paragraph, then in the last.
    const positions = [2, Math.floor(editor.state.doc.content.size / 2), editor.state.doc.content.size - 2]
    const times: number[] = []
    for (const pos of positions) {
      const $p = editor.state.doc.resolve(Math.max(1, Math.min(pos, editor.state.doc.content.size - 1)))
      const inside = $p.parent.isTextblock ? $p.pos : $p.pos + 1
      const t2 = performance.now()
      editor.view.dispatch(editor.state.tr.insertText('x', inside))
      times.push(performance.now() - t2)
    }
    log(`${name}: keystroke dispatch ms (start, middle, end)`, times.map(ms).join(', '))
    const t3 = performance.now()
    serializeBody(editor)
    log(`${name}: serializeBody after edits ms`, performance.now() - t3)
    // Ten keystrokes in a row at the end (typing a word).
    const t4 = performance.now()
    for (let k = 0; k < 10; k++) editor.view.dispatch(editor.state.tr.insertText('y', editor.state.doc.content.size - 2))
    log(`${name}: 10 keystrokes at end ms`, performance.now() - t4)
    editor.destroy()
    el.remove()
  }
  writeFileSync('/tmp/claude-0/-home-user-Objects/925c9253-6d40-5f27-a712-45dc1ac4b9ca/scratchpad/perf-editor.txt', results.join('\n'))
  expect(true).toBe(true)
}, 180_000)
