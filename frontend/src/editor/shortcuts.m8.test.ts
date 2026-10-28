import { Editor as TiptapEditor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('./turnInto', () => ({
  turnIntoObject: vi.fn(async () => true),
  turnIntoTask: vi.fn(async () => true),
  turnTodoIntoTask: vi.fn(async () => true),
}))

import { allShortcuts, keysFor } from '@/lib/shortcuts'
import { editorExtensions, loadBody, serializeBody } from './document'
import { BLOCK_REFERENCE_COPIED, setEditorObject } from './nodes/blockRef'
import { setHighlightTextHandler } from './nodes/textStyle'
import { M8_EDITOR_SHORTCUT_IDS, M8_EDITOR_SHORTCUTS } from './shortcuts'
import { turnIntoObject, turnIntoTask, turnTodoIntoTask } from './turnInto'

const editors: TiptapEditor[] = []
afterEach(() => {
  while (editors.length) editors.pop()!.destroy()
  setHighlightTextHandler(null)
  document.querySelectorAll('[data-editor-toasts]').forEach((n) => n.remove())
})

const writeText = vi.fn(async (_text: string) => undefined)
beforeEach(() => {
  writeText.mockClear()
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
})

function headless(body: string): TiptapEditor {
  const editor = new TiptapEditor({ extensions: editorExtensions() })
  loadBody(editor, body)
  editors.push(editor)
  return editor
}

function cursorIn(editor: TiptapEditor, text: string): void {
  let pos = -1
  editor.state.doc.descendants((node, p) => {
    if (pos < 0 && node.isTextblock && node.textContent.includes(text)) pos = p + node.nodeSize - 1
    return pos < 0
  })
  if (pos < 0) throw new Error(`no block with ${text}`)
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)))
}

/** Press the registry's key for `spec` (`Mod-Alt-r`, `Shift-Tab`) as a browser sends it (not on macOS). */
function press(editor: TiptapEditor, spec: string): boolean {
  const parts = spec.split('-')
  const key = parts.pop()!
  const mods = new Set(parts)
  const letter = /^[a-z]$/i.test(key)
  const event = new KeyboardEvent('keydown', {
    key: letter && mods.has('Shift') ? key.toUpperCase() : key,
    code: letter ? `Key${key.toUpperCase()}` : key,
    ctrlKey: mods.has('Mod') || mods.has('Ctrl'),
    shiftKey: mods.has('Shift'),
    altKey: mods.has('Alt'),
    bubbles: true,
    cancelable: true,
  })
  if (letter) Object.defineProperty(event, 'keyCode', { value: key.toUpperCase().charCodeAt(0) })
  return editor.view.someProp('handleKeyDown', (f) => f(editor.view, event)) ?? false
}

describe('m8 editor shortcuts', () => {
  test('the new ids are registered with their reference names', () => {
    expect(M8_EDITOR_SHORTCUT_IDS).toEqual(['copyBlockReference', 'turnIntoObject', 'turnIntoTask', 'turnBlockIntoTaskObject', 'highlightText'])
    const registered = new Map(allShortcuts().map((d) => [d.id, d]))
    for (const def of M8_EDITOR_SHORTCUTS) {
      const r = registered.get(def.id)!
      expect(r, def.id).toBeDefined()
      expect(r.scope).toBe('editor')
      expect(r.keys.length).toBeGreaterThan(0)
    }
    // shortcuts.<id>.name, verbatim
    expect(registered.get('copyBlockReference')!.name).toBe('Copy block reference')
    expect(registered.get('highlightText')!.name).toBe('Highlight text selection')
    expect(registered.get('turnBlockIntoTaskObject')!.name).toBe('Turn block into task object')
  })

  test('tab indents any block', () => {
    const body = 'Parent\n\nChild\n\nAfter\n'
    const editor = headless(body)
    cursorIn(editor, 'Child')
    expect(press(editor, keysFor('indentBlocks')[0])).toBe(true)
    expect(serializeBody(editor)).toBe('<!-- indent -->\nParent\n\nChild\n<!-- /indent -->\n\nAfter\n')
    // The caret stays in the moved block.
    expect(editor.state.selection.$from.parent.textContent).toBe('Child')
    expect(press(editor, keysFor('unindentBlocks')[0])).toBe(true)
    expect(serializeBody(editor)).toBe(body)
    // A heading indents too; the first block has nothing above and the key is still taken.
    const ed2 = headless('# Title\n\n## Section\n')
    cursorIn(ed2, 'Section')
    press(ed2, 'Tab')
    expect(serializeBody(ed2)).toBe('<!-- indent -->\n# Title\n\n## Section\n<!-- /indent -->\n')
    cursorIn(ed2, 'Title')
    expect(press(ed2, 'Tab')).toBe(true)

    // List items keep M7's Tab (sink the item), not an indent container.
    const list = headless('- one\n- two\n')
    cursorIn(list, 'two')
    press(list, 'Tab')
    expect(serializeBody(list)).toBe('- one\n  - two\n')

    // Table cells keep their own Tab.
    const table = headless('Text\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n')
    cursorIn(table, 'a')
    press(table, 'Tab')
    expect(serializeBody(table)).toBe('Text\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n')
    expect(table.state.selection.$from.parent.textContent).toBe('b')
  })

  test('new shortcuts dispatch their commands', async () => {
    const editor = headless('A quotable line\n\n- [ ] A to-do\n')
    setEditorObject(editor, { path: 'Pages/Notes.md', title: 'Notes' })
    cursorIn(editor, 'A quotable line')
    expect(press(editor, keysFor('copyBlockReference')[0])).toBe(true)
    const id = /\^([a-z0-9]{6})$/.exec(serializeBody(editor).split('\n')[0])?.[1]
    expect(id).toBeTruthy()
    expect(writeText).toHaveBeenCalledWith(`![[Notes#^${id}]]`)
    expect(document.querySelector('[data-editor-toasts]')?.textContent).toContain(BLOCK_REFERENCE_COPIED)
    // Again: the same id, nothing new written.
    press(editor, keysFor('copyBlockReference')[0])
    expect(writeText).toHaveBeenLastCalledWith(`![[Notes#^${id}]]`)
    expect(serializeBody(editor).match(/\^[a-z0-9]{6}/g)).toHaveLength(1)

    // Highlight: the default toggles the last-used colour, bg-amber at first (Object); an installed handler wins.
    const ed2 = headless('Mark this word\n')
    ed2.view.dispatch(ed2.state.tr.setSelection(TextSelection.create(ed2.state.doc, 6, 10)))
    expect(press(ed2, keysFor('highlightText')[0])).toBe(true)
    expect(serializeBody(ed2)).toBe('Mark <mark data-color="bg-amber">this</mark> word\n')
    press(ed2, keysFor('highlightText')[0])
    expect(serializeBody(ed2)).toBe('Mark this word\n')
    const handler = vi.fn(() => true)
    setHighlightTextHandler(handler)
    press(ed2, keysFor('highlightText')[0])
    expect(handler).toHaveBeenCalledWith(ed2)

    // Turn into: the Task 27 functions, with the editor.
    press(editor, keysFor('turnIntoObject')[0])
    press(editor, keysFor('turnIntoTask')[0])
    cursorIn(editor, 'A to-do')
    press(editor, keysFor('turnBlockIntoTaskObject')[0])
    await Promise.resolve()
    expect(turnIntoObject).toHaveBeenCalledWith(editor)
    expect(turnIntoTask).toHaveBeenCalledWith(editor)
    expect(turnTodoIntoTask).toHaveBeenCalledWith(editor)
  })
})
