import { Editor as TiptapEditor } from '@tiptap/core'
import { EditorContent } from '@tiptap/react'
import { act, render, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { editorExtensions, loadBody, serializeBody } from '../document'
import { CodeHighlightKey, grammarOf, highlightTokens, HIGHLIGHT_DEBOUNCE_MS, registeredGrammars } from './highlight'
import { LANGUAGES, PLAIN_TEXT } from './languages'

vi.mock('mermaid', () => ({
  default: { initialize: vi.fn(), render: vi.fn(async () => ({ svg: '<svg></svg>' })) },
}))

const editors: TiptapEditor[] = []
afterEach(() => {
  while (editors.length) editors.pop()!.destroy()
  vi.useRealTimers()
})

function mount(body: string): TiptapEditor {
  const element = document.createElement('div')
  document.body.appendChild(element)
  const editor = new TiptapEditor({ element, extensions: editorExtensions() })
  editors.push(editor)
  loadBody(editor, body)
  return editor
}

/** The classes covering each highlighted run, as `text → classes`. */
function runs(editor: TiptapEditor): Map<string, string> {
  const set = CodeHighlightKey.getState(editor.state)!
  const out = new Map<string, string>()
  for (const d of set.find()) {
    const text = editor.state.doc.textBetween(d.from, d.to)
    const cls = (d as unknown as { type: { attrs: { class: string } } }).type.attrs.class
    out.set(text, out.has(text) ? `${out.get(text)} ${cls}` : cls)
  }
  return out
}

const classesOf = (tokens: ReturnType<typeof highlightTokens>, text: string, src: string) =>
  tokens.filter((t) => src.slice(t.from, t.to) === text).map((t) => t.className)

describe('code highlighting', () => {
  test('test python and javascript get token classes', () => {
    const py = 'def greet(name):\n    # say hi\n    return "hi " + name\n'
    const pyTokens = highlightTokens(py, 'python')
    expect(classesOf(pyTokens, 'def', py)).toEqual(['hljs-keyword'])
    expect(classesOf(pyTokens, 'return', py)).toEqual(['hljs-keyword'])
    expect(classesOf(pyTokens, '# say hi', py)).toEqual(['hljs-comment'])
    expect(classesOf(pyTokens, '"hi "', py)).toEqual(['hljs-string'])

    const js = 'const n = 42 // answer\nlet s = `x`\n'
    const jsTokens = highlightTokens(js, 'js')
    expect(classesOf(jsTokens, 'const', js)).toEqual(['hljs-keyword'])
    expect(classesOf(jsTokens, '42', js)).toEqual(['hljs-number'])
    expect(classesOf(jsTokens, '// answer', js)).toEqual(['hljs-comment'])

    // Entities in highlight.js's output map back onto the original offsets.
    const html = '<a href="x">&amp;</a>'
    for (const t of highlightTokens(html, 'html')) expect(t.to).toBeLessThanOrEqual(html.length)
    expect(classesOf(highlightTokens(html, 'html'), 'a', html)).toContain('hljs-tag hljs-name')
    // A scope inside a template substitution takes its own class, not the string's.
    const tpl = 'const s = `a${b ? 1 : 2}`'
    expect(classesOf(highlightTokens(tpl, 'javascript'), '1', tpl)).toEqual(['hljs-number'])

    // In the editor, the decorations land on the code text and render as spans.
    const editor = mount('Intro\n\n```python\ndef f():\n    return 1\n```\n\n```javascript\nconst a = "b"\n```\n')
    const r = runs(editor)
    expect(r.get('def')).toBe('hljs-keyword')
    expect(r.get('return')).toBe('hljs-keyword')
    expect(r.get('const')).toBe('hljs-keyword')
    expect(r.get('"b"')).toBe('hljs-string')
  })

  test('highlighted runs render as spans in the code block view', async () => {
    const editor = new TiptapEditor({ extensions: editorExtensions() })
    editors.push(editor)
    render(createElement(EditorContent, { editor }))
    await act(async () => {
      loadBody(editor, '```python\ndef f():\n    return 1\n```\n')
    })
    await waitFor(() => {
      const spans = [...document.querySelectorAll('.code-block code .hljs-keyword')].map((s) => s.textContent)
      expect(spans).toEqual(['def', 'return'])
    })
  })

  test('test highlighting never changes the document', async () => {
    vi.useFakeTimers()
    const body = 'Intro\r\n\r\n```python\r\nx = 1  # one\r\n```\r\n\r\nOutro\r\n'
    const editor = mount(body)
    const updates = vi.fn()
    editor.on('update', updates)
    expect(serializeBody(editor)).toBe(body)
    const before = editor.state.doc

    // An edit elsewhere: the code block's runs are mapped, then recomputed after the debounce.
    editor.chain().insertContentAt(1, 'A').run()
    expect(updates).toHaveBeenCalledTimes(1)
    const afterEdit = editor.state.doc
    await vi.advanceTimersByTimeAsync(HIGHLIGHT_DEBOUNCE_MS + 10)
    expect(editor.state.doc).toBe(afterEdit)
    expect(updates).toHaveBeenCalledTimes(1)
    expect(runs(editor).get('# one')).toBe('hljs-comment')

    // Undo gives the original bytes back: highlighting added no history step.
    editor.commands.undo()
    expect(editor.state.doc.eq(before)).toBe(true)
    expect(serializeBody(editor)).toBe(body)

    // Typing inside the code re-highlights it without touching other text.
    let codeEnd = -1
    editor.state.doc.descendants((n, pos) => {
      if (n.type.name === 'codeBlock') codeEnd = pos + n.nodeSize - 1
    })
    editor.chain().insertContentAt(codeEnd, '\nif x: pass').run()
    await vi.advanceTimersByTimeAsync(HIGHLIGHT_DEBOUNCE_MS + 10)
    expect(runs(editor).get('if')).toBe('hljs-keyword')
    expect(serializeBody(editor)).toBe('Intro\r\n\r\n```python\r\nx = 1  # one\r\nif x: pass\r\n```\r\n\r\nOutro\r\n')
  })

  test('test unknown language is plain', () => {
    expect(highlightTokens('def f(): return 1', '')).toEqual([])
    expect(highlightTokens('def f(): return 1', 'klingon')).toEqual([])
    expect(highlightTokens('graph TD; A-->B', 'mermaid')).toEqual([])
    expect(grammarOf('klingon')).toBeNull()
    const editor = mount('```\ndef f(): return 1\n```\n\n```klingon\nqaStaH nuq\n```\n')
    expect(CodeHighlightKey.getState(editor.state)!.find()).toEqual([])
    expect(editor.view.dom.querySelector('[class^="hljs-"]')).toBeNull()
  })

  test('test every language maps to a registered grammar', () => {
    const registered = registeredGrammars()
    for (const lang of LANGUAGES) {
      if (lang === PLAIN_TEXT || lang.id === 'mermaid') {
        expect(lang.hljs, lang.label).toBeUndefined()
        continue
      }
      expect(lang.hljs, lang.label).toBeTruthy()
      expect(registered, lang.label).toContain(lang.hljs)
      expect(grammarOf(lang.id), lang.label).toBe(lang.hljs)
      for (const alias of lang.aliases ?? []) expect(grammarOf(alias), alias).toBe(lang.hljs)
    }
  })
})
