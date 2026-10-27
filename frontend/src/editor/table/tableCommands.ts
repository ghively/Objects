/**
 * Table commands for the table menus (Capacities' `SimpleTableBlock`): the
 * "Header row" / "Header column" switches, the row, column and cell items and
 * "Delete table".
 *
 * A table is addressed by its position (`tablePos`) and a cell by its row and
 * column index. Row and column edits go through Tiptap's `TableKit` commands
 * (`addRowBefore`, `addColumnAfter`, `deleteRow`, ...) with the selection put
 * in the target cell first; clearing empties cells in place. Every edit is an
 * ordinary document change, so M1's `preserveTable` keeps the original
 * alignment and padding of the rows it did not touch.
 *
 * The header switches only write options (`no-header-row`, `header-column`):
 * the file always keeps its GFM header and separator lines, so hiding the
 * header row changes the display, never the table's Markdown shape.
 */
import type { Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state'
import { TableMap } from '@tiptap/pm/tables'
import type { Option } from '../annotations'

export type CellRef = { row: number; col: number }

/** The table node at `pos`, or null. */
export function tableAt(doc: PMNode, pos: number): PMNode | null {
  const node = doc.nodeAt(pos)
  return node && node.type.name === 'table' ? node : null
}

function optionOf(node: PMNode, key: string): string | true | undefined {
  return ((node.attrs.blockOptions as Option[] | null) ?? []).find((o) => o.key === key)?.value
}

/** Whether the table shows its first row as header cells (`hasHeaderRow`; on unless `no-header-row`). */
export function hasHeaderRow(table: PMNode): boolean {
  return optionOf(table, 'no-header-row') !== true
}

/** Whether the table shows its first column as header cells (`hasHeaderColumn`; off unless `header-column`). */
export function hasHeaderColumn(table: PMNode): boolean {
  return optionOf(table, 'header-column') === true
}

/** "Header row": writes or removes `no-header-row`. */
export function setHeaderRow(editor: Editor, tablePos: number, show: boolean): boolean {
  if (!tableAt(editor.state.doc, tablePos)) return false
  return editor.chain().setBlockOption('no-header-row', show ? null : true, tablePos).run()
}

/** "Header column": writes or removes `header-column`. */
export function setHeaderColumn(editor: Editor, tablePos: number, show: boolean): boolean {
  if (!tableAt(editor.state.doc, tablePos)) return false
  return editor.chain().setBlockOption('header-column', show ? true : null, tablePos).run()
}

/** The row and column of the cell holding the selection, when it is in the table at `tablePos`. */
export function selectedCell(state: EditorState, tablePos: number): CellRef | null {
  const table = tableAt(state.doc, tablePos)
  if (!table) return null
  const $from = state.selection.$from
  for (let d = $from.depth; d >= 1; d--) {
    const role = $from.node(d).type.spec.tableRole
    if ((role === 'cell' || role === 'header_cell') && $from.before(d - 2) === tablePos) {
      const map = TableMap.get(table)
      const rect = map.findCell($from.before(d) - tablePos - 1)
      return { row: rect.top, col: rect.left }
    }
  }
  return null
}

/** The absolute position of the cell at `cell` (the cell node's own position). */
export function cellPos(doc: PMNode, tablePos: number, cell: CellRef): number | null {
  const table = tableAt(doc, tablePos)
  if (!table) return null
  const map = TableMap.get(table)
  if (cell.row < 0 || cell.row >= map.height || cell.col < 0 || cell.col >= map.width) return null
  return tablePos + 1 + map.positionAt(cell.row, cell.col, table)
}

/** Table size: rows and columns. */
export function tableSize(table: PMNode): { rows: number; cols: number } {
  const map = TableMap.get(table)
  return { rows: map.height, cols: map.width }
}

function selectCell(tr: Transaction, tablePos: number, cell: CellRef): boolean {
  const at = cellPos(tr.doc, tablePos, cell)
  if (at == null) return false
  tr.setSelection(TextSelection.near(tr.doc.resolve(at + 1)))
  return true
}

type TableCommand =
  | 'addRowBefore'
  | 'addRowAfter'
  | 'addColumnBefore'
  | 'addColumnAfter'
  | 'deleteRow'
  | 'deleteColumn'
  | 'deleteTable'

/** Put the cursor in `cell` and run one TableKit command, as one transaction. */
function runAt(editor: Editor, tablePos: number, cell: CellRef, command: TableCommand): boolean {
  if (cellPos(editor.state.doc, tablePos, cell) == null) return false
  return editor
    .chain()
    .command(({ tr }) => selectCell(tr, tablePos, cell))
    [command]()
    .run()
}

/** The cell types of row `row`: rows below the header are plain cells, the header row header cells. */
function retypeRow(tr: Transaction, tablePos: number, row: number, header: boolean): void {
  const table = tableAt(tr.doc, tablePos)
  if (!table) return
  const { tableHeader, tableCell } = tr.doc.type.schema.nodes
  const map = TableMap.get(table)
  for (let col = 0; col < map.width; col++) {
    const pos = tablePos + 1 + map.positionAt(row, col, table)
    const node = tr.doc.nodeAt(pos)
    const type = header ? tableHeader : tableCell
    if (node && node.type !== type) tr.setNodeMarkup(pos, type, node.attrs)
  }
}

/**
 * "Insert row above": a row above the header row becomes the new header row
 * (GFM has exactly one), and the old header's cells become ordinary cells.
 */
export function insertRowAbove(editor: Editor, tablePos: number, row: number): boolean {
  if (!runAt(editor, tablePos, { row, col: 0 }, 'addRowBefore')) return false
  if (row === 0) {
    editor
      .chain()
      .command(({ tr }) => {
        retypeRow(tr, tablePos, 0, true)
        retypeRow(tr, tablePos, 1, false)
        return true
      })
      .run()
  }
  return true
}

/** "Insert row below": a row below the header row is an ordinary row. */
export function insertRowBelow(editor: Editor, tablePos: number, row: number): boolean {
  if (!runAt(editor, tablePos, { row, col: 0 }, 'addRowAfter')) return false
  if (row === 0) {
    editor
      .chain()
      .command(({ tr }) => {
        retypeRow(tr, tablePos, 1, false)
        return true
      })
      .run()
  }
  return true
}

/** "Delete row": deleting the header row makes the next row the header; the last row deletes the table. */
export function deleteRow(editor: Editor, tablePos: number, row: number): boolean {
  const table = tableAt(editor.state.doc, tablePos)
  if (!table) return false
  if (tableSize(table).rows <= 1) return deleteTable(editor, tablePos)
  if (!runAt(editor, tablePos, { row, col: 0 }, 'deleteRow')) return false
  if (row === 0) {
    editor
      .chain()
      .command(({ tr }) => {
        retypeRow(tr, tablePos, 0, true)
        return true
      })
      .run()
  }
  return true
}

export function insertColumnBefore(editor: Editor, tablePos: number, col: number): boolean {
  return runAt(editor, tablePos, { row: 0, col }, 'addColumnBefore')
}

export function insertColumnAfter(editor: Editor, tablePos: number, col: number): boolean {
  return runAt(editor, tablePos, { row: 0, col }, 'addColumnAfter')
}

/** "Delete column": the last column deletes the table. */
export function deleteColumn(editor: Editor, tablePos: number, col: number): boolean {
  const table = tableAt(editor.state.doc, tablePos)
  if (!table) return false
  if (tableSize(table).cols <= 1) return deleteTable(editor, tablePos)
  return runAt(editor, tablePos, { row: 0, col }, 'deleteColumn')
}

/** "Delete table". */
export function deleteTable(editor: Editor, tablePos: number): boolean {
  if (!tableAt(editor.state.doc, tablePos)) return false
  return runAt(editor, tablePos, { row: 0, col: 0 }, 'deleteTable')
}

/** Empty the given cells (each keeps one empty paragraph), in one transaction. */
function clearCells(editor: Editor, tablePos: number, cells: CellRef[]): boolean {
  const table = tableAt(editor.state.doc, tablePos)
  if (!table) return false
  return editor
    .chain()
    .command(({ tr }) => {
      const { paragraph } = tr.doc.type.schema.nodes
      // Back to front, so earlier positions stay valid.
      const positions = cells
        .map((c) => cellPos(tr.doc, tablePos, c))
        .filter((p): p is number => p != null)
        .sort((a, b) => b - a)
      let changed = false
      for (const pos of positions) {
        const cell = tr.doc.nodeAt(pos)
        if (!cell) continue
        if (cell.childCount === 1 && cell.firstChild!.isTextblock && cell.firstChild!.content.size === 0) continue
        tr.replaceWith(pos + 1, pos + cell.nodeSize - 1, paragraph.create())
        changed = true
      }
      return changed || true
    })
    .run()
}

/** "Clear row". */
export function clearRow(editor: Editor, tablePos: number, row: number): boolean {
  const table = tableAt(editor.state.doc, tablePos)
  if (!table) return false
  const { cols } = tableSize(table)
  return clearCells(editor, tablePos, Array.from({ length: cols }, (_, col) => ({ row, col })))
}

/** "Clear column". */
export function clearColumn(editor: Editor, tablePos: number, col: number): boolean {
  const table = tableAt(editor.state.doc, tablePos)
  if (!table) return false
  const { rows } = tableSize(table)
  return clearCells(editor, tablePos, Array.from({ length: rows }, (_, row) => ({ row, col })))
}

/** "Clear cell contents". */
export function clearCell(editor: Editor, tablePos: number, cell: CellRef): boolean {
  return clearCells(editor, tablePos, [cell])
}
