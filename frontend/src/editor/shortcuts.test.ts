import { Editor as TiptapEditor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { afterEach, describe, expect, test } from 'vitest'
import { allShortcuts, keysFor, registerShortcuts } from '@/lib/shortcuts'
import { editorExtensions, loadBody, serializeBody } from './document'
import { OPEN_BLOCK_MENU_EVENT, type OpenBlockMenuDetail } from './extensions/openBlockStyling'
import { EDITOR_SHORTCUT_IDS, EDITOR_SHORTCUTS, keymapFor, proseMirrorKey } from './shortcuts'

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
  test('every editor id of the key table is registered as text or block editing, with the expected keys', () => {
    expect(EDITOR_SHORTCUT_IDS).toEqual([
      'bold', 'italic', 'underline', 'strikethrough', 'codeToken', 'mathToken',
      'heading1', 'heading2', 'heading3', 'heading4', 'toDo', 'toggle', 'toggleCodeBlock', 'toggleMathBlock',
      'textAlignLeft', 'textAlignCenter', 'textAlignRight',
      'selectActiveBlock', 'expandBlockSelectionUpwards', 'expandBlockSelectionDownwards', 'selectAllBlocks',
      'deleteBlocks', 'duplicateBlocks', 'copyBlocksAsMarkdown', 'moveSelectedBlocksUp', 'moveSelectedBlocksDown',
      'moveSelectedBlocksUpOnSameLevel', 'moveSelectedBlocksDownOnSameLevel',
      'moveUpBlockWithCursor', 'moveDownBlockWithCursor', 'moveUpBlockWithCursorOnSameLevel', 'moveDownBlockWithCursorOnSameLevel',
      'indentBlocks', 'unindentBlocks', 'toggleTodoInBlockWithCursor', 'toggleToggleInBlockWithCursor',
      'insertBlockAbove', 'insertBlockBelow',
    ])
    // The expected shortcut table (the behaviour catalog's Shortcuts sheet), Windows column; [] = none listed.
    const EXPECTED: Record<string, string[]> = {
      mathToken: ['Mod-m'],
      heading1: [], heading2: [], heading3: [], heading4: [], toDo: [], toggle: [],
      textAlignLeft: [], textAlignCenter: [], textAlignRight: [],
      toggleCodeBlock: ['Mod-e'],
      toggleMathBlock: ['Mod-m'],
      moveSelectedBlocksUp: ['Alt-ArrowUp'],
      moveSelectedBlocksDown: ['Alt-ArrowDown'],
      moveSelectedBlocksUpOnSameLevel: ['Alt-Shift-ArrowUp'],
      moveSelectedBlocksDownOnSameLevel: ['Alt-Shift-ArrowDown'],
      moveUpBlockWithCursor: ['Alt-ArrowUp'],
      moveDownBlockWithCursor: ['Alt-ArrowDown'],
      moveUpBlockWithCursorOnSameLevel: ['Alt-Shift-ArrowUp'],
      moveDownBlockWithCursorOnSameLevel: ['Alt-Shift-ArrowDown'],
      toggleToggleInBlockWithCursor: ['Mod-Enter', 'Mod-Shift-Enter', 'Mod-ArrowUp', 'Mod-ArrowDown'],
      underline: [],
    }
    for (const [id, keys] of Object.entries(EXPECTED)) expect(keysFor(id), id).toEqual(keys)
    const registered = new Map(allShortcuts().map((d) => [d.id, d]))
    for (const def of EDITOR_SHORTCUTS) {
      const r = registered.get(def.id)!
      expect(r.scope).toBe('editor')
      expect(r.provisional, def.id).toBe(false)
      expect(['text', 'block']).toContain(r.category)
      if (!(def.id in EXPECTED)) expect(r.keys.length, def.id).toBeGreaterThan(0)
    }
    // the catalogued names
    expect(registered.get('heading1')!.name).toBe('Make the selected blocks heading 1')
    expect(registered.get('mathToken')!.name).toBe('Format as TeX formula')
    expect(registered.get('insertBlockBelow')!.name).toBe('New block below, with the cursor in it')
    expect(registered.get('moveUpBlockWithCursor')!.name).toBe('Move active block up')
    expect(registered.get('moveSelectedBlocksUpOnSameLevel')!.name).toBe('Shift the selected blocks up among their siblings')
  })

  test('editor shortcuts come from the registry and a changed key takes effect', () => {
    const original = allShortcuts().find((d) => d.id === 'textAlignCenter')!
    try {
      // Text alignment has no key (Ctrl+Shift+R is bound to nothing; Ctrl+Shift+E is now "Open block styling").
      let editor = headless('Hello\n\nWorld\n')
      expect(press(editor, 'r', { ctrl: true, shift: true })).toBe(false)
      expect(serializeBody(editor)).toBe('Hello\n\nWorld\n')

      // A key added in the registry: a new editor uses it.
      registerShortcuts([{ ...original, keys: ['Mod-Alt-9'] }])
      expect(keysFor('textAlignCenter')).toEqual(['Mod-Alt-9'])
      editor = headless('Hello\n\nWorld\n')
      expect(press(editor, '9', { ctrl: true, alt: true })).toBe(true)
      expect(serializeBody(editor)).toBe('<!-- block: align=center -->\nHello\n\nWorld\n')
    } finally {
      registerShortcuts([original])
    }
  })

  test('headings, to-do, toggle and alignment have no key (markdown only)', () => {
    const editor = headless('Hello\n\nWorld\n')
    for (const [k, mods] of [
      ['2', { ctrl: true, alt: true }],
      ['t', { ctrl: true, alt: true }],
      ['g', { ctrl: true, alt: true }],
      ['l', { ctrl: true, shift: true }],
      ['e', { ctrl: true, shift: true }],
      ['r', { ctrl: true, shift: true }],
    ] as const) {
      press(editor, k, mods)
      expect(serializeBody(editor), `${k}`).toBe('Hello\n\nWorld\n')
    }
  })

  test('block shortcuts: code and math block with blocks selected, tokens on text, to-do, toggle, insert below', () => {
    // Mod-e / Mod-m with blocks selected: code block / math block.
    const code = headless('Hello\n\nWorld\n')
    expect(press(code, 'Escape')).toBe(true)
    expect(press(code, 'e', { ctrl: true })).toBe(true)
    expect(serializeBody(code)).toBe('```\nHello\n```\n\nWorld\n')
    const math = headless('x^2\n\nWorld\n')
    press(math, 'Escape')
    press(math, 'm', { ctrl: true })
    expect(serializeBody(math)).toBe('$$\nx^2\n$$\n\nWorld\n')
    // The old keys do nothing.
    const old = headless('x^2\n\nWorld\n')
    press(old, 'Escape')
    press(old, 'm', { ctrl: true, alt: true })
    press(old, 'c', { ctrl: true, alt: true })
    expect(serializeBody(old)).toBe('x^2\n\nWorld\n')

    // Mod-e / Mod-m on a text selection: code token / TeX formula.
    const tokens = headless('Hello world\n')
    tokens.view.dispatch(tokens.state.tr.setSelection(TextSelection.create(tokens.state.doc, 1, 6)))
    expect(press(tokens, 'e', { ctrl: true })).toBe(true)
    expect(serializeBody(tokens)).toBe('`Hello` world\n')
    const tex = headless('Hello x^2\n')
    tex.view.dispatch(tex.state.tr.setSelection(TextSelection.create(tex.state.doc, 7, 10)))
    expect(press(tex, 'm', { ctrl: true })).toBe(true)
    expect(serializeBody(tex)).toContain('$x^2$')

    // Mod-Enter checks a to-do; in a toggle (no to-do) it opens and closes the toggle.
    const todo = headless('- [ ] Hello\n\nWorld\n')
    press(todo, 'Enter', { ctrl: true })
    expect(serializeBody(todo)).toBe('- [x] Hello\n\nWorld\n')
    const toggle = headless('<!-- toggle open -->\nHello\n\nChild\n<!-- /toggle -->\n')
    expect(press(toggle, 'Enter', { ctrl: true })).toBe(true)
    expect(serializeBody(toggle)).toBe('<!-- toggle -->\nHello\n\nChild\n<!-- /toggle -->\n')
    expect(press(toggle, 'Enter', { ctrl: true, shift: true })).toBe(true)
    expect(serializeBody(toggle)).toBe('<!-- toggle open -->\nHello\n\nChild\n<!-- /toggle -->\n')

    const insert = headless('Hello\n\nWorld\n')
    press(insert, 'Enter', { alt: true })
    insert.commands.insertContent('New')
    expect(serializeBody(insert)).toBe('Hello\n\nNew\n\nWorld\n')
  })

  test('AltCtrl keys become Alt, or Ctrl on macOS, in the ProseMirror key map', () => {
    expect(proseMirrorKey('Mod-AltCtrl-l', false)).toBe('Mod-Alt-l')
    expect(proseMirrorKey('Mod-AltCtrl-l', true)).toBe('Mod-Ctrl-l')
    expect(proseMirrorKey('Alt-ArrowUp', true)).toBe('Alt-ArrowUp')
  })

  test('Ctrl+Shift+E (Open block styling) asks the handles overlay for the block menu of the cursor block', () => {
    const editor = headless('Hello\n\nWorld\n')
    const asked: number[] = []
    editor.view.dom.addEventListener(OPEN_BLOCK_MENU_EVENT, (e) => asked.push((e as CustomEvent<OpenBlockMenuDetail>).detail.pos))
    expect(press(editor, 'e', { ctrl: true, shift: true })).toBe(true)
    expect(asked).toEqual([0])
    expect(serializeBody(editor)).toBe('Hello\n\nWorld\n')
    // Not in a read-only editor.
    editor.setEditable(false)
    expect(press(editor, 'e', { ctrl: true, shift: true })).toBe(false)
    expect(asked).toEqual([0])
  })

  test('Mod-Shift-b is the shortcuts menu, not a quote', () => {
    const editor = headless('Hello\n')
    press(editor, 'b', { ctrl: true, shift: true })
    expect(serializeBody(editor)).toBe('Hello\n')
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
  // Known issue 3: StarterKit's (and the list and code block extensions') own keys fired beside the
  // registry, so a changed registry key left the old built-in key working.
  type Combo = [string, { ctrl?: boolean; shift?: boolean; alt?: boolean }]
  const rebinds: { id: string; body: string; old: Combo; before: string; blocks?: boolean }[] = [
    { id: 'heading1', body: 'Hello\n\nWorld\n', old: ['1', { ctrl: true, alt: true }], before: '# Hello\n\nWorld\n' },
    { id: 'heading4', body: 'Hello\n\nWorld\n', old: ['4', { ctrl: true, alt: true }], before: '#### Hello\n\nWorld\n' },
    { id: 'bold', body: 'Hello\n\nWorld\n', old: ['b', { ctrl: true }], before: '' },
    { id: 'italic', body: 'Hello\n\nWorld\n', old: ['i', { ctrl: true }], before: '' },
    { id: 'underline', body: 'Hello\n\nWorld\n', old: ['u', { ctrl: true }], before: '' },
    { id: 'strikethrough', body: 'Hello\n\nWorld\n', old: ['s', { ctrl: true, shift: true }], before: '' },
    { id: 'codeToken', body: 'Hello\n\nWorld\n', old: ['e', { ctrl: true }], before: '' },
    { id: 'toggleCodeBlock', body: 'Hello\n\nWorld\n', old: ['c', { ctrl: true, alt: true }], before: '', blocks: true },
  ]
  for (const { id, body, old, blocks } of rebinds) {
    test(`a changed ${id} key leaves no built-in key behind`, () => {
      const original = allShortcuts().find((d) => d.id === id)!
      try {
        registerShortcuts([{ ...original, keys: ['Mod-Alt-F9'] }])
        const editor = headless(body)
        // Select the first word so the mark keys have something to act on.
        editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, 6)))
        // Block keys act on selected blocks.
        if (blocks) press(editor, 'Escape')
        const before = editor.getJSON()
        press(editor, ...old)
        expect(editor.getJSON()).toEqual(before)
        expect(serializeBody(editor)).toBe(body)
        expect(press(editor, 'F9', { ctrl: true, alt: true })).toBe(true)
        expect(serializeBody(editor)).not.toBe(body)
      } finally {
        registerShortcuts([original])
      }
    })
  }

  test('only the registry key turns a block into a to-do (no Mod-Shift-9)', () => {
    const editor = headless('Hello\n\nWorld\n')
    press(editor, '9', { ctrl: true, shift: true })
    expect(serializeBody(editor)).toBe('Hello\n\nWorld\n')
  })

  test('Tab in a list item indents through the registry key, and a changed key leaves Tab inert', () => {
    const body = '- one\n- two\n'
    let editor = headless(body)
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve(body.indexOf('two') + 4))))
    expect(editor.state.selection.$from.parent.textContent).toBe('two')
    expect(press(editor, 'Tab')).toBe(true)
    expect(serializeBody(editor)).toBe('- one\n  - two\n')
    expect(press(editor, 'Tab', { shift: true })).toBe(true)
    expect(serializeBody(editor)).toBe('- one\n- two\n')

    const ind = allShortcuts().find((d) => d.id === 'indentBlocks')!
    try {
      registerShortcuts([{ ...ind, keys: ['Mod-Alt-F9'] }])
      editor = headless(body)
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve(body.indexOf('two') + 4))))
      press(editor, 'Tab')
      expect(serializeBody(editor)).toBe(body)
      expect(press(editor, 'F9', { ctrl: true, alt: true })).toBe(true)
      expect(serializeBody(editor)).toBe('- one\n  - two\n')
    } finally {
      registerShortcuts([ind])
    }
  })
})
