import { Editor as TiptapEditor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import { settingsDefaults, useSettings } from '@/settings/useSettings'
import { editorExtensions, loadBody, serializeBody } from '../document'

const editors: TiptapEditor[] = []
afterEach(() => {
  while (editors.length) editors.pop()!.destroy()
  document.body.innerHTML = ''
  useSettings.setState({ settings: settingsDefaults })
})

function mounted(body: string): TiptapEditor {
  const element = document.createElement('div')
  document.body.appendChild(element)
  const editor = new TiptapEditor({ element, extensions: editorExtensions() })
  loadBody(editor, body)
  editors.push(editor)
  return editor
}

const CLOSED = '<!-- toggle -->\n### Closed toggle\nHidden child paragraph.\n- a hidden item\n<!-- /toggle -->\n\nAfter.\n'
const OPEN = '<!-- toggle open -->\n### Server checklist\n- [ ] Patch the hosts\n<!-- /toggle -->\n'
const EMPTY = '<!-- toggle open -->\nJust the line\n<!-- /toggle -->\n'

function toggles(editor: TiptapEditor): HTMLElement[] {
  return Array.from(editor.view.dom.querySelectorAll<HTMLElement>('.block-toggle'))
}

function caretOf(el: HTMLElement): HTMLElement {
  return el.querySelector<HTMLElement>(':scope > .toggle-caret')!
}

function childrenOf(el: HTMLElement): HTMLElement[] {
  return Array.from(el.querySelector<HTMLElement>(':scope > .toggle-content')!.children) as HTMLElement[]
}

describe('toggle node view', () => {
  test('toggle caret opens and closes and writes the open option once', () => {
    const editor = mounted(CLOSED)
    let transactions = 0
    editor.on('transaction', ({ transaction }) => {
      if (transaction.docChanged) transactions++
    })
    const [toggle] = toggles(editor)
    expect(toggle).toHaveAttribute('data-open', 'false')
    expect(caretOf(toggle)).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(caretOf(toggle))
    expect(transactions).toBe(1)
    expect(toggles(editor)[0]).toHaveAttribute('data-open', 'true')
    expect(serializeBody(editor)).toBe(CLOSED.replace('<!-- toggle -->', '<!-- toggle open -->'))

    fireEvent.click(caretOf(toggles(editor)[0]))
    expect(transactions).toBe(2)
    expect(toggles(editor)[0]).toHaveAttribute('data-open', 'false')
    // Closed again: the original bytes come back (the keep rule).
    expect(serializeBody(editor)).toBe(CLOSED)
  })

  test('closing moves a cursor out of the hidden children', () => {
    const editor = mounted(OPEN)
    let itemPos = -1
    editor.state.doc.descendants((node, pos) => {
      if (node.isTextblock && node.textContent === 'Patch the hosts') itemPos = pos + 1
    })
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, itemPos)))
    fireEvent.click(caretOf(toggles(editor)[0]))
    expect(editor.state.selection.$from.parent.textContent).toBe('Server checklist')
  })

  test('closed toggle hides children; empty toggle uses the empty colour', () => {
    const editor = mounted(CLOSED + '\n' + EMPTY)
    const [closed, empty] = toggles(editor)
    const kids = childrenOf(closed)
    expect(kids).toHaveLength(3)
    expect(kids[0]).not.toHaveAttribute('data-toggle-hidden')
    expect(kids[0].style.display).toBe('')
    for (const kid of kids.slice(1)) {
      expect(kid).toHaveAttribute('data-toggle-hidden')
      expect(kid.style.display).toBe('none')
    }
    expect(caretOf(closed).style.color).toBe('var(--editor-toggle)')
    expect(closed).not.toHaveAttribute('data-empty')

    expect(empty).toHaveAttribute('data-empty')
    expect(caretOf(empty).style.color).toBe('var(--editor-toggle-empty)')

    // Opened, the children show.
    fireEvent.click(caretOf(closed))
    for (const kid of childrenOf(toggles(editor)[0])) expect(kid).not.toHaveAttribute('data-toggle-hidden')
  })

  test('bullet toggle style and hidden outliner lines follow settings', () => {
    const editor = mounted(OPEN)
    const toggle = toggles(editor)[0]
    const outline = toggle.querySelector<HTMLElement>(':scope > .toggle-outline')!
    expect(toggle).toHaveAttribute('data-toggle-style', 'toggle')
    expect(toggle).toHaveAttribute('data-outline', 'true')
    expect(outline.hidden).toBe(false)
    expect(caretOf(toggle).querySelector('.toggle-bullet')).not.toBeNull()
    expect(caretOf(toggle).querySelector('.toggle-caret-icon')).not.toBeNull()

    useSettings.setState({ settings: { ...settingsDefaults, toggleStyle: 'bullet', hideOutlinerLines: true } })
    expect(toggle).toHaveAttribute('data-toggle-style', 'bullet')
    expect(toggle).toHaveAttribute('data-outline', 'false')
    expect(outline.hidden).toBe(true)

    // A toggle mounted while the settings are on starts with them.
    const later = mounted(OPEN)
    expect(toggles(later)[0]).toHaveAttribute('data-toggle-style', 'bullet')
  })

  test('a read-only editor does not write the open line', () => {
    const editor = mounted(CLOSED)
    editor.setEditable(false)
    fireEvent.click(caretOf(toggles(editor)[0]))
    expect(serializeBody(editor)).toBe(CLOSED)
  })
})
