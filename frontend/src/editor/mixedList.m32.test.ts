/**
 * M32 item 4, "Markdown habits": a list that mixes bullets and to-dos (typed or pasted as
 * `- a` / `- [ ] b`) is one list whose lines each render as what they are: a to-do has its box
 * and no bullet dot, with its text beside the box.
 */
import { Editor as TiptapEditor } from '@tiptap/core'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { editorExtensions, loadBody, serializeBody } from './document'

const editors: TiptapEditor[] = []
afterEach(() => {
  while (editors.length) editors.pop()!.destroy()
  document.body.innerHTML = ''
})

function mounted(body: string): TiptapEditor {
  const element = document.createElement('div')
  document.body.appendChild(element)
  const editor = new TiptapEditor({ element, extensions: editorExtensions() })
  loadBody(editor, body)
  editors.push(editor)
  return editor
}

/** Paste `text` as `text/plain` at the selection (a real paste event). */
function paste(editor: TiptapEditor, text: string): void {
  const event = new Event('paste', { bubbles: true, cancelable: true }) as Event & { clipboardData: unknown }
  event.clipboardData = { getData: (type: string) => (type === 'text/plain' ? text : ''), types: ['text/plain'], files: [] }
  editor.view.dom.dispatchEvent(event)
}

/** Each line of the first list: its node type, and what its `<li>` holds. */
function lines(editor: TiptapEditor) {
  const list = editor.view.dom.querySelector('ul')!
  return [...list.children].map((li) => ({
    kind: li.hasAttribute('data-checked') ? 'todo' : 'bullet',
    box: !!li.querySelector(':scope > label > input[type="checkbox"]'),
    checked: (li.querySelector(':scope > label > input') as HTMLInputElement | null)?.checked ?? null,
    // A to-do's text is in its `<div>` (the label holds the box and its screen-reader name).
    text: (li.querySelector(':scope > div') ?? li).textContent,
  }))
}

const MIXED = '- apples\n- [ ] call the bank\n- [x] pay rent\n- pears\n'

describe('a list mixing bullets and to-dos (M32)', () => {
  test('test a mixed list is one list: bullets stay bullets, to-dos have their box', () => {
    const editor = mounted(MIXED)
    expect(editor.state.doc.child(0).type.name).toBe('bulletList')
    expect(editor.view.dom.querySelectorAll('ul')).toHaveLength(1)
    expect(lines(editor)).toEqual([
      { kind: 'bullet', box: false, checked: null, text: 'apples' },
      { kind: 'todo', box: true, checked: false, text: 'call the bank' },
      { kind: 'todo', box: true, checked: true, text: 'pay rent' },
      { kind: 'bullet', box: false, checked: null, text: 'pears' },
    ])
    // Opening it changes nothing in the file.
    expect(serializeBody(editor)).toBe(MIXED)
  })

  test('test a to-do line holds its box and its text side by side in one item', () => {
    const editor = mounted(MIXED)
    const todo = editor.view.dom.querySelector('ul > li[data-checked]')!
    expect([...todo.children].map((c) => c.tagName)).toEqual(['LABEL', 'DIV'])
    expect(todo.querySelector(':scope > div')!.textContent).toBe('call the bank')
    // The list around it is a plain bullet list (the style sheet's mixed-list rule keys on this).
    expect(todo.parentElement!.getAttribute('data-type')).not.toBe('taskList')
  })

  test('test a pasted mixed list is one list with the same lines', () => {
    const editor = mounted('')
    editor.commands.setTextSelection(1)
    paste(editor, '- apples\n- [ ] call the bank\n- [x] pay rent')
    expect(editor.state.doc.child(0).type.name).toBe('bulletList')
    expect(lines(editor).map((l) => [l.kind, l.checked, l.text])).toEqual([
      ['bullet', null, 'apples'],
      ['todo', false, 'call the bank'],
      ['todo', true, 'pay rent'],
    ])
    expect(serializeBody(editor).trimEnd()).toBe('- apples\n- [ ] call the bank\n- [x] pay rent')
  })

  test('test the style sheet gives a to-do in a bullet list no dot and puts its text beside its box', () => {
    const css = readFileSync(join(__dirname, 'editor.css'), 'utf8').replace(/\s+/g, ' ')
    // Every to-do item, whatever list holds it, is a row: box, then text.
    expect(/\.object-editor li\[data-checked\] \{[^}]*display: flex;[^}]*list-style: none;/.test(css)).toBe(true)
    expect(/\.object-editor li\[data-checked\] > div \{[^}]*flex: 1;/.test(css)).toBe(true)
    // In a bullet list its box sits where the dot would be.
    expect(/\.object-editor ul:not\(\[data-type='taskList'\]\) > li\[data-checked\] \{[^}]*margin-left:/.test(css)).toBe(true)
    // A bullet nested under a to-do keeps its dot (the old rule made every nested line a row).
    expect(/ul\[data-type='taskList'\] li \{/.test(css)).toBe(false)
  })
})
