import { Editor as TiptapEditor } from '@tiptap/core'
import { afterEach, describe, expect, test } from 'vitest'
import { editorExtensions, loadBody, serializeBody } from '../document'
import {
  clearCell,
  clearColumn,
  clearRow,
  deleteColumn,
  deleteRow,
  deleteTable,
  hasHeaderColumn,
  hasHeaderRow,
  insertColumnAfter,
  insertColumnBefore,
  insertRowAbove,
  insertRowBelow,
  selectedCell,
  setHeaderColumn,
  setHeaderRow,
  sortColumn,
  tableAt,
  tableGrid,
} from './tableCommands'

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

function tablePos(editor: TiptapEditor): number {
  let at = -1
  editor.state.doc.descendants((node, pos) => {
    if (at < 0 && node.type.name === 'table') at = pos
    return at < 0
  })
  return at
}

const TABLE = ['| Host  | Role |', '| :---- | ---: |', '| alpha | db   |', '| beta  | web  |'].join('\n')
const BODY = `Before\n\n${TABLE}\n\nAfter\n`

describe('tableCommands', () => {
  test('header row and header column switches write their options', () => {
    const editor = headless(BODY)
    const pos = tablePos(editor)
    expect(hasHeaderRow(tableAt(editor.state.doc, pos)!)).toBe(true)
    expect(hasHeaderColumn(tableAt(editor.state.doc, pos)!)).toBe(false)

    setHeaderRow(editor, pos, false)
    expect(serializeBody(editor)).toBe(`Before\n\n<!-- block: no-header-row -->\n${TABLE}\n\nAfter\n`)
    setHeaderColumn(editor, tablePos(editor), true)
    expect(serializeBody(editor)).toBe(`Before\n\n<!-- block: header-column no-header-row -->\n${TABLE}\n\nAfter\n`)
    expect(hasHeaderRow(tableAt(editor.state.doc, tablePos(editor))!)).toBe(false)
    expect(hasHeaderColumn(tableAt(editor.state.doc, tablePos(editor))!)).toBe(true)

    setHeaderRow(editor, tablePos(editor), true)
    setHeaderColumn(editor, tablePos(editor), false)
    expect(serializeBody(editor)).toBe(BODY)
  })

  test('table edit keeps the original alignment of untouched rows', () => {
    // Regression guard over M1's preserveTable (green from the start).
    const editor = headless(BODY)
    insertRowBelow(editor, tablePos(editor), 2)
    const out = serializeBody(editor)
    const lines = out.split('\n')
    expect(lines.slice(2, 6)).toEqual(TABLE.split('\n'))
    expect(lines[6]).toMatch(/^\|\s*\|\s*\|$/)
    expect(lines.slice(7)).toEqual(['', 'After', ''])
  })

  test('insert rows above and below, including above the header row', () => {
    const editor = headless(BODY)
    insertRowAbove(editor, tablePos(editor), 2)
    let table = tableAt(editor.state.doc, tablePos(editor))!
    expect(table.childCount).toBe(4)
    expect(table.child(2).textContent).toBe('')
    expect(table.child(3).textContent).toBe('betaweb')

    insertRowAbove(editor, tablePos(editor), 0)
    table = tableAt(editor.state.doc, tablePos(editor))!
    expect(table.childCount).toBe(5)
    expect(table.child(0).firstChild!.type.name).toBe('tableHeader')
    expect(table.child(1).firstChild!.type.name).toBe('tableCell')
    expect(table.child(1).textContent).toBe('HostRole')
    // Still one valid GFM table: header, separator, rows.
    const lines = serializeBody(editor).split('\n').slice(2, 8)
    expect(lines[1]).toMatch(/^\|\s*:?-+:?\s*\|\s*:?-+:?\s*\|$/)
    expect(lines[2]).toContain('Host')

    insertRowBelow(editor, tablePos(editor), 0)
    table = tableAt(editor.state.doc, tablePos(editor))!
    expect(table.child(1).firstChild!.type.name).toBe('tableCell')
  })

  test('delete, clear and insert columns and rows', () => {
    const editor = headless(BODY)
    insertColumnAfter(editor, tablePos(editor), 1)
    expect(tableAt(editor.state.doc, tablePos(editor))!.child(0).childCount).toBe(3)
    insertColumnBefore(editor, tablePos(editor), 0)
    let table = tableAt(editor.state.doc, tablePos(editor))!
    expect(table.child(0).childCount).toBe(4)
    expect(table.child(0).child(0).type.name).toBe('tableHeader')
    deleteColumn(editor, tablePos(editor), 0)
    deleteColumn(editor, tablePos(editor), 2)
    expect(serializeBody(editor)).toContain('| alpha | db')

    clearRow(editor, tablePos(editor), 1)
    table = tableAt(editor.state.doc, tablePos(editor))!
    expect(table.child(1).textContent).toBe('')
    expect(table.child(2).textContent).toBe('betaweb')

    clearColumn(editor, tablePos(editor), 1)
    table = tableAt(editor.state.doc, tablePos(editor))!
    expect(table.child(0).textContent).toBe('Host')
    expect(table.child(2).textContent).toBe('beta')

    clearCell(editor, tablePos(editor), { row: 0, col: 0 })
    expect(tableAt(editor.state.doc, tablePos(editor))!.child(0).textContent).toBe('')

    deleteRow(editor, tablePos(editor), 0)
    table = tableAt(editor.state.doc, tablePos(editor))!
    expect(table.childCount).toBe(2)
    expect(table.child(0).firstChild!.type.name).toBe('tableHeader')
    expect(table.child(0).textContent).toBe('')

    deleteTable(editor, tablePos(editor))
    expect(tablePos(editor)).toBe(-1)
    expect(serializeBody(editor)).toBe('Before\n\nAfter\n')
  })

  test('selectedCell reports the cell under the cursor', () => {
    const editor = headless(BODY)
    const pos = tablePos(editor)
    expect(selectedCell(editor.state, pos)).toBeNull()
    let at = -1
    editor.state.doc.descendants((node, p) => {
      if (at < 0 && node.isTextblock && node.textContent === 'web') at = p + 1
    })
    editor.commands.setTextSelection(at)
    expect(selectedCell(editor.state, pos)).toEqual({ row: 2, col: 1 })
  })

  test('test sort ascending and descending keeps header', () => {
    const rows = [
      '| Name  | Qty |',
      '| ----- | --- |',
      '| pear  | 10  |',
      '| Apple | 2   |',
      '|       | 7   |',
      '| fig   | =SUM(5,-1) |',
      '| beta  | 9   |',
    ]
    const body = `Before\n\n${rows.join('\n')}\n\nAfter\n`
    const editor = headless(body)
    const names = () => tableGrid(tableAt(editor.state.doc, tablePos(editor))!).map((r) => r[0])
    const qty = () => tableGrid(tableAt(editor.state.doc, tablePos(editor))!).map((r) => r[1])

    // Text case-insensitively, empty cells last.
    expect(sortColumn(editor, tablePos(editor), 0, 'asc')).toBe(true)
    expect(names()).toEqual(['Name', 'Apple', 'beta', 'fig', 'pear', ''])
    let out = serializeBody(editor)
    expect(out.startsWith('Before\n\n| Name')).toBe(true)
    expect(out.endsWith('\n\nAfter\n')).toBe(true)
    const lines = out.split('\n')
    expect(lines[3]).toBe('| ----- | --- |')
    expect(lines[4]).toBe('| Apple | 2   |')
    // One edit: a single undo restores the original bytes.
    editor.commands.undo()
    expect(serializeBody(editor)).toBe(body)

    sortColumn(editor, tablePos(editor), 0, 'desc')
    expect(names()).toEqual(['Name', 'pear', 'fig', 'beta', 'Apple', ''])

    // Numbers numerically (2 < 4 < 7 < 9 < 10), a formula by its value.
    editor.commands.setContent('')
    loadBody(editor, body)
    sortColumn(editor, tablePos(editor), 1, 'asc')
    expect(qty()).toEqual(['Qty', '2', '=SUM(5,-1)', '7', '9', '10'])
    sortColumn(editor, tablePos(editor), 1, 'desc')
    expect(qty()[0]).toBe('Qty')
    expect(qty().slice(1, 3)).toEqual(['10', '9'])

    // Already in order: no edit.
    const before = serializeBody(editor)
    const doc = editor.state.doc
    sortColumn(editor, tablePos(editor), 1, 'desc')
    expect(editor.state.doc).toBe(doc)
    expect(serializeBody(editor)).toBe(before)
  })
})
