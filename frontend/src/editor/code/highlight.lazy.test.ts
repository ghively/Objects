/**
 * Grammars load on demand (audit 2026-11-01 F1). This file starts with none
 * loaded (vitest gives each file its own module state): a code block is plain
 * until its grammar arrives, then highlighted without any document change.
 */
import { Editor as TiptapEditor } from '@tiptap/core'
import { waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { editorExtensions, loadBody, serializeBody } from '../document'
import { CodeHighlightKey, grammarOf, highlightTokens, loadGrammar, registeredGrammars } from './highlight'

vi.mock('mermaid', () => ({
  default: { initialize: vi.fn(), render: vi.fn(async () => ({ svg: '<svg></svg>' })) },
}))

const editors: TiptapEditor[] = []
afterEach(() => {
  while (editors.length) editors.pop()!.destroy()
})

describe('lazy grammars', () => {
  test('a block is plain until its grammar has loaded, then highlighted with no document change', async () => {
    expect(registeredGrammars()).toEqual([])
    expect(grammarOf('python')).toBe('python')
    const body = 'Intro\n\n```python\ndef f():\n    return 1\n```\n'
    const editor = new TiptapEditor({ extensions: editorExtensions() })
    editors.push(editor)
    const updates = vi.fn()
    editor.on('update', updates)
    loadBody(editor, body)
    const before = editor.state.doc
    // Not highlighted yet (the load was started by the first pass).
    expect(CodeHighlightKey.getState(editor.state)!.find()).toEqual([])
    await waitFor(() => expect(registeredGrammars()).toContain('python'))
    await waitFor(() => {
      const runs = CodeHighlightKey.getState(editor.state)!.find()
      expect(runs.length).toBeGreaterThan(0)
    })
    expect(editor.state.doc).toBe(before)
    expect(updates).not.toHaveBeenCalled()
    expect(serializeBody(editor)).toBe(body)
    expect(editor.can().undo()).toBe(false)
  })

  test('highlightTokens is empty before the load and tokens after; unknown grammars never load', async () => {
    expect(registeredGrammars()).not.toContain('rust')
    expect(highlightTokens('fn main() {}', 'rust')).toEqual([])
    expect(await loadGrammar('rust')).toBe(true)
    expect(highlightTokens('fn main() {}', 'rust').map((t) => t.className)).toContain('hljs-keyword')
    expect(await loadGrammar('klingon')).toBe(false)
  })
})
