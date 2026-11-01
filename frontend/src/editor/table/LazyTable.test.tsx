/**
 * Lazy table views (audit 2026-11-01 P8): a big table starts as a static
 * preview and becomes the editable table on a click or when the caret enters
 * it; the document and its Markdown never change for it.
 */
import { Editor as TiptapEditor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { afterEach, describe, expect, test } from 'vitest'
import { editorExtensions, loadBody, serializeBody } from '../document'
import { expandTable, isTableExpanded, LAZY_TABLE_ROWS, PREVIEW_ROWS } from './LazyTable'

const editors: TiptapEditor[] = []
afterEach(() => {
  while (editors.length) editors.pop()!.destroy()
  document.body.innerHTML = ''
})

function mount(body: string): TiptapEditor {
  const element = document.createElement('div')
  document.body.appendChild(element)
  const editor = new TiptapEditor({ element, extensions: editorExtensions() })
  editors.push(editor)
  loadBody(editor, body)
  return editor
}

function tableBody(rows: number): string {
  const lines = ['| Host | Port |', '| --- | --- |']
  for (let r = 0; r < rows; r++) lines.push(`| host-${r} | ${1000 + r} |`)
  return lines.join('\n') + '\n'
}

const BIG = tableBody(LAZY_TABLE_ROWS + 10)

describe('LazyTable', () => {
  test('a big table renders as a preview of its first rows, a small one in full', () => {
    const editor = mount(`Intro\n\n${BIG}\n${tableBody(3)}`)
    const previews = editor.view.dom.querySelectorAll('.table-preview')
    expect(previews).toHaveLength(1)
    expect(previews[0].querySelectorAll('tr')).toHaveLength(PREVIEW_ROWS)
    expect(previews[0].querySelector('.table-preview-more')?.textContent).toBe(`Show all ${LAZY_TABLE_ROWS + 11} rows`)
    expect(previews[0].textContent).toContain('host-0')
    // The small table is the ordinary editable table.
    const tables = editor.view.dom.querySelectorAll('.tableWrapper:not(.table-preview) table')
    expect(tables).toHaveLength(1)
    expect(tables[0].querySelectorAll('tr')).toHaveLength(4)
    expect(serializeBody(editor)).toBe(`Intro\n\n${BIG}\n${tableBody(3)}`)
  })

  test('a click expands the table in place and the editor is unchanged', () => {
    const editor = mount(`Intro\n\n${BIG}`)
    const before = editor.state.doc
    const preview = editor.view.dom.querySelector('.table-preview') as HTMLElement
    preview.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(editor.view.dom.querySelector('.table-preview')).toBeNull()
    const table = editor.view.dom.querySelector('.tableWrapper table')!
    expect(table.querySelectorAll('tr')).toHaveLength(LAZY_TABLE_ROWS + 11)
    expect(editor.state.doc).toBe(before)
    expect(isTableExpanded(editor.state, 7)).toBe(true)
    // The caret went into the first cell.
    expect(editor.state.selection.$from.parent.textContent).toBe('Host')
  })

  test('the caret entering the table expands it, and the expansion survives edits elsewhere', () => {
    const editor = mount(`Intro\n\n${BIG}\nAfter\n`)
    expect(isTableExpanded(editor.state, 7)).toBe(false)
    const firstCell = editor.state.doc.resolve(7 + 3)
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near(firstCell)))
    expect(isTableExpanded(editor.state, 7)).toBe(true)
    expect(editor.view.dom.querySelector('.table-preview')).toBeNull()
    editor.view.dispatch(editor.state.tr.insertText('XYZ', 1))
    expect(isTableExpanded(editor.state, 10)).toBe(true)
    expect(editor.view.dom.querySelector('.table-preview')).toBeNull()
    expect(serializeBody(editor)).toBe(`XYZIntro\n\n${BIG}\nAfter\n`)
  })

  test('expandTable is a meta-only transaction: no update event, no history step', () => {
    const editor = mount(`Intro\n\n${BIG}`)
    let updates = 0
    editor.on('update', () => updates++)
    expandTable(editor.view, 7)
    expect(isTableExpanded(editor.state, 7)).toBe(true)
    expect(updates).toBe(0)
    expect(editor.can().undo()).toBe(false)
  })

  test('a reload starts from previews again', () => {
    const editor = mount(`Intro\n\n${BIG}`)
    expandTable(editor.view, 7)
    loadBody(editor, `Other\n\n${BIG}`)
    expect(editor.view.dom.querySelectorAll('.table-preview')).toHaveLength(1)
  })
})
