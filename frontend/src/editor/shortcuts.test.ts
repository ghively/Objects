import { Editor as TiptapEditor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { afterEach, describe, expect, test } from 'vitest'
import { allShortcuts, keysFor, registerShortcuts } from '@/lib/shortcuts'
import { editorExtensions, loadBody, serializeBody } from './document'
import { EDITOR_SHORTCUT_IDS, EDITOR_SHORTCUTS, keymapFor } from './shortcuts'

const editors: TiptapEditor[] = []
afterEach(() => {
  while (editors.length) editors.pop()!.destroy()
})

function headless(body: string): TiptapEditor {
  const editor = new TiptapEditor({ extensions: editorExtensions() })
  loadBody(editor, body)
  editors.push(editor)
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 2)))
  return editor
}

function press(editor: TiptapEditor, key: string, mods: { ctrl?: boolean; shift?: boolean; alt?: boolean } = {}): boolean {
  // As a browser sends it: a shifted letter comes upper case, with its key code.
  const letter = /^[a-z]$/.test(key)
  const event = new KeyboardEvent('keydown', {
    key: letter && mods.shift ? key.toUpperCase() : key,
    ctrlKey: !!mods.ctrl,
    shiftKey: !!mods.shift,
    altKey: !!mods.alt,
    bubbles: true,
    cancelable: true,
  })
  if (letter) Object.defineProperty(event, 'keyCode', { value: key.toUpperCase().charCodeAt(0) })
  return editor.view.someProp('handleKeyDown', (f) => f(editor.view, event)) ?? false
}

describe('editor shortcuts', () => {
  test('every editor id of the key table is registered as provisional text or block editing', () => {
    expect(EDITOR_SHORTCUT_IDS).toEqual([
      'bold', 'italic', 'underline', 'strikethrough', 'codeToken', 'mathToken',
      'heading1', 'heading2', 'heading3', 'heading4', 'toDo', 'toggle', 'toggleCodeBlock', 'toggleMathBlock',
      'textAlignLeft', 'textAlignCenter', 'textAlignRight',
      'selectActiveBlock', 'expandBlockSelectionUpwards', 'expandBlockSelectionDownwards', 'selectAllBlocks',
      'deleteBlocks', 'duplicateBlocks', 'copyBlocksAsMarkdown', 'moveSelectedBlocksUp', 'moveSelectedBlocksDown',
      'indentBlocks', 'unindentBlocks', 'toggleTodoInBlockWithCursor', 'toggleToggleInBlockWithCursor',
      'insertBlockAbove', 'insertBlockBelow',
    ])
    const registered = new Map(allShortcuts().map((d) => [d.id, d]))
    for (const def of EDITOR_SHORTCUTS) {
      const r = registered.get(def.id)!
      expect(r.scope).toBe('editor')
      expect(def.provisional).toBe(true)
      expect(['text', 'block']).toContain(r.category)
      expect(r.keys.length).toBeGreaterThan(0)
    }
    // shortcuts.<id>.name, verbatim
    expect(registered.get('heading1')!.name).toBe('Turn selected blocks into heading 1')
    expect(registered.get('mathToken')!.name).toBe('Format as TeX-formula')
    expect(registered.get('insertBlockBelow')!.name).toBe('Insert block below and set cursor there')
  })

  test('editor shortcuts come from the registry and a changed key takes effect', () => {
    const original = allShortcuts().find((d) => d.id === 'textAlignCenter')!
    try {
      let editor = headless('Hello\n\nWorld\n')
      expect(press(editor, 'e', { ctrl: true, shift: true })).toBe(true)
      expect(serializeBody(editor)).toBe('<!-- block: align=center -->\nHello\n\nWorld\n')

      // Correct the key in the registry: a new editor uses it, and the old key is gone.
      registerShortcuts([{ ...original, keys: ['Mod-Alt-9'] }])
      expect(keysFor('textAlignCenter')).toEqual(['Mod-Alt-9'])
      editor = headless('Hello\n\nWorld\n')
      expect(press(editor, 'e', { ctrl: true, shift: true })).toBe(false)
      expect(serializeBody(editor)).toBe('Hello\n\nWorld\n')
      expect(press(editor, '9', { ctrl: true, alt: true })).toBe(true)
      expect(serializeBody(editor)).toBe('<!-- block: align=center -->\nHello\n\nWorld\n')
    } finally {
      registerShortcuts([original])
    }
  })

  test('heading shortcut turns the block into a heading', () => {
    const editor = headless('Hello\n\nWorld\n')
    expect(press(editor, '2', { ctrl: true, alt: true })).toBe(true)
    expect(serializeBody(editor)).toBe('## Hello\n\nWorld\n')
  })

  test('block shortcuts: align, to-do, toggle, math block, insert below', () => {
    const editor = headless('Hello\n\nWorld\n')
    press(editor, 'e', { ctrl: true, shift: true })
    expect(serializeBody(editor)).toBe('<!-- block: align=center -->\nHello\n\nWorld\n')
    press(editor, 'l', { ctrl: true, shift: true })
    expect(serializeBody(editor)).toBe('Hello\n\nWorld\n')

    press(editor, 't', { ctrl: true, alt: true })
    expect(serializeBody(editor)).toBe('- [ ] Hello\n\nWorld\n')
    press(editor, 'Enter', { ctrl: true })
    expect(serializeBody(editor)).toBe('- [x] Hello\n\nWorld\n')

    const other = headless('Hello\n\nWorld\n')
    press(other, 'g', { ctrl: true, alt: true })
    expect(serializeBody(other)).toBe('<!-- toggle open -->\nHello\n<!-- /toggle -->\n\nWorld\n')

    const math = headless('x^2\n\nWorld\n')
    press(math, 'm', { ctrl: true, alt: true })
    expect(serializeBody(math)).toBe('$$\nx^2\n$$\n\nWorld\n')

    const insert = headless('Hello\n\nWorld\n')
    press(insert, 'Enter', { alt: true })
    insert.commands.insertContent('New')
    expect(serializeBody(insert)).toBe('Hello\n\nNew\n\nWorld\n')
  })

  test('keymapFor chains two ids on one key', () => {
    const calls: string[] = []
    const map = keymapFor({
      deleteBlocks: () => {
        calls.push('delete')
        return false
      },
      selectActiveBlock: () => {
        calls.push('escape')
        return true
      },
    })
    expect(Object.keys(map).sort()).toEqual([...keysFor('deleteBlocks'), ...keysFor('selectActiveBlock')].sort())
    expect(map.Backspace()).toBe(false)
    expect(calls).toEqual(['delete'])
  })
})
