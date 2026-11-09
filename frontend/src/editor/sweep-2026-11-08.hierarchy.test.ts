// The 2026-11-08 sweep, round 3: Increase / decrease text hierarchy (Ctrl+Plus / Ctrl+Minus,
// the catalog's Block editing group), exercised in a live editor. Only the touched blocks' lines
// change; every other byte of the body stays.
import { Editor as TiptapEditor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { afterEach, describe, expect, test } from 'vitest'
import { keysFor } from '@/lib/shortcuts'
import { editorExtensions, loadBody, serializeBody } from './document'
import { getBlockSelection, selectBlocks } from './extensions/blockSelection'
import { stepHierarchy } from './extensions/textHierarchy'

const editors: TiptapEditor[] = []
afterEach(() => {
  while (editors.length) editors.pop()!.destroy()
})

function headless(body: string): TiptapEditor {
  const editor = new TiptapEditor({ extensions: editorExtensions() })
  loadBody(editor, body)
  editors.push(editor)
  return editor
}

/** The start position of the first text block whose text contains `text`. */
function blockPos(editor: TiptapEditor, text: string): number {
  let pos = -1
  editor.state.doc.descendants((node, p) => {
    if (pos < 0 && node.isTextblock && node.textContent.includes(text)) pos = p
    return pos < 0
  })
  if (pos < 0) throw new Error(`no block with ${text}`)
  return pos
}

/** Put the cursor at the end of the first text block containing `text`. */
function cursorAtEndOf(editor: TiptapEditor, text: string): void {
  const pos = blockPos(editor, text)
  const node = editor.state.doc.nodeAt(pos)!
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos + node.nodeSize - 1)))
}

/** The physical keys behind the characters a browser reports (w3c-keyname's base table). */
const KEY_CODES: Record<string, number> = { '=': 187, '+': 187, '-': 189 }

/**
 * Press a key on the editor's DOM as a browser sends it (not on macOS): `Mod-=` is Ctrl with
 * the = key, `Mod-+` is Ctrl+Shift+= (the key reads "+"), `Mod--` is Ctrl with the minus key.
 * Returns whether the default (the browser's zoom) was prevented.
 */
function press(editor: TiptapEditor, spec: string): boolean {
  const key = spec.endsWith('--') ? '-' : spec.slice(spec.lastIndexOf('-') + 1)
  const mods = spec.slice(0, spec.length - key.length - 1).split('-').filter(Boolean)
  const event = new KeyboardEvent('keydown', {
    key,
    ctrlKey: mods.includes('Mod') || mods.includes('Ctrl'),
    shiftKey: mods.includes('Shift') || key === '+',
    altKey: mods.includes('Alt'),
    bubbles: true,
    cancelable: true,
  })
  if (key in KEY_CODES) Object.defineProperty(event, 'keyCode', { value: KEY_CODES[key] })
  return !editor.view.dom.dispatchEvent(event)
}

const BODY = 'Intro paragraph.\n\n# Title\n\n## Section\n\n### Part\n\n#### Detail\n\n<!-- block: small -->\nFine print.\n\n- a list\n- of two\n\nLast.\n'

describe('Increase / decrease text hierarchy (Ctrl+Plus / Ctrl+Minus)', () => {
  test('the keys are the registry’s', () => {
    expect(keysFor('increaseTextHierarchy')).toEqual(['Mod-='])
    expect(keysFor('decreaseTextHierarchy')).toEqual(['Mod--'])
  })

  test('Ctrl+Minus steps the block with the cursor down: heading 1 to 2, 2 to 3, 3 to 4, 4 to text', () => {
    const editor = headless(BODY)
    cursorAtEndOf(editor, 'Title')
    expect(press(editor, 'Mod--')).toBe(true)
    expect(serializeBody(editor)).toBe(BODY.replace('# Title', '## Title'))
    press(editor, 'Mod--')
    expect(serializeBody(editor)).toBe(BODY.replace('# Title', '### Title'))
    press(editor, 'Mod--')
    expect(serializeBody(editor)).toBe(BODY.replace('# Title', '#### Title'))
    press(editor, 'Mod--')
    expect(serializeBody(editor)).toBe(BODY.replace('# Title', 'Title'))
    // Text steps down to Small; Small stays Small.
    press(editor, 'Mod--')
    expect(serializeBody(editor)).toBe(BODY.replace('# Title', '<!-- block: small -->\nTitle'))
    press(editor, 'Mod--')
    expect(serializeBody(editor)).toBe(BODY.replace('# Title', '<!-- block: small -->\nTitle'))
  })

  test('Ctrl+Plus steps up: text to heading 4, then 3, 2, 1, and heading 1 stays', () => {
    const editor = headless(BODY)
    cursorAtEndOf(editor, 'Intro paragraph.')
    expect(press(editor, 'Mod-=')).toBe(true)
    expect(serializeBody(editor)).toBe(BODY.replace('Intro paragraph.', '#### Intro paragraph.'))
    press(editor, 'Mod-=')
    expect(serializeBody(editor)).toBe(BODY.replace('Intro paragraph.', '### Intro paragraph.'))
    press(editor, 'Mod-=')
    expect(serializeBody(editor)).toBe(BODY.replace('Intro paragraph.', '## Intro paragraph.'))
    press(editor, 'Mod-=')
    expect(serializeBody(editor)).toBe(BODY.replace('Intro paragraph.', '# Intro paragraph.'))
    press(editor, 'Mod-=')
    expect(serializeBody(editor)).toBe(BODY.replace('Intro paragraph.', '# Intro paragraph.'))
  })

  test('Ctrl+Shift+= (the key reads "+") increases too; Small steps up to text', () => {
    const editor = headless(BODY)
    cursorAtEndOf(editor, 'Fine print.')
    expect(press(editor, 'Mod-+')).toBe(true)
    expect(serializeBody(editor)).toBe(BODY.replace('<!-- block: small -->\nFine print.', 'Fine print.'))
    press(editor, 'Mod-+')
    expect(serializeBody(editor)).toBe(BODY.replace('<!-- block: small -->\nFine print.', '#### Fine print.'))
  })

  test('with a block selection every selected text block steps, together, and the selection stays', () => {
    const editor = headless(BODY)
    selectBlocks(editor, blockPos(editor, 'Title'), blockPos(editor, 'Detail'))
    expect(press(editor, 'Mod--')).toBe(true)
    expect(serializeBody(editor)).toBe(
      BODY.replace('# Title', '## Title').replace('## Section', '### Section').replace('### Part', '#### Part').replace('#### Detail', 'Detail'),
    )
    expect(getBlockSelection(editor.state)).not.toBeNull()
    expect(stepHierarchy(editor, 1)).toBe(true)
    expect(serializeBody(editor)).toBe(BODY)
  })

  test('a selection with a list in it leaves the list alone and steps the text blocks around it', () => {
    const editor = headless(BODY)
    selectBlocks(editor, blockPos(editor, 'Fine print.'), blockPos(editor, 'Last.'))
    press(editor, 'Mod-=')
    expect(serializeBody(editor)).toBe(BODY.replace('<!-- block: small -->\nFine print.', 'Fine print.').replace('Last.', '#### Last.'))
  })

  test('the cursor in a list item changes nothing (the key is still consumed: no browser zoom); a read-only editor leaves the key alone', () => {
    const editor = headless(BODY)
    cursorAtEndOf(editor, 'of two')
    expect(press(editor, 'Mod-=')).toBe(true)
    expect(serializeBody(editor)).toBe(BODY)
    const readOnly = headless(BODY)
    readOnly.setEditable(false)
    cursorAtEndOf(readOnly, 'Title')
    expect(press(readOnly, 'Mod--')).toBe(false)
    expect(serializeBody(readOnly)).toBe(BODY)
  })

  test('a heading with a color keeps its option line when it steps', () => {
    const body = 'A\n\n<!-- block: color=text-red -->\n## Red heading\n\nB\n'
    const editor = headless(body)
    cursorAtEndOf(editor, 'Red heading')
    press(editor, 'Mod--')
    expect(serializeBody(editor)).toBe('A\n\n<!-- block: color=text-red -->\n### Red heading\n\nB\n')
    press(editor, 'Mod-=')
    press(editor, 'Mod-=')
    expect(serializeBody(editor)).toBe('A\n\n<!-- block: color=text-red -->\n# Red heading\n\nB\n')
  })
})
