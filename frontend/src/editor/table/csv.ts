/**
 * "Export as CSV" (`blocks.simpleTable.export`): the table as RFC 4180 CSV,
 * each cell as the table shows it (a formula as its value, an error as its
 * title), rows joined with CRLF. The file is named `<object title>.csv` and is
 * saved through a temporary object URL (no server round trip).
 */
import type { Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { editorObjectTitle } from '../nodes/blockRef'
import { shownGrid, tableAt } from './tableCommands'

/** One field: quoted when it holds `"`, `,`, CR or LF, with `"` doubled. */
export function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/** Rows of fields as CSV text (CRLF between records, no trailing line break). */
export function toCsv(rows: ReadonlyArray<ReadonlyArray<string>>): string {
  return rows.map((row) => row.map(csvField).join(',')).join('\r\n')
}

/** A table node as CSV, its cells as shown. */
export function tableToCsv(table: PMNode): string {
  return toCsv(shownGrid(table).shown)
}

/** `<title>.csv`, with characters no file name may hold replaced by `_` (our choice; "Table" without a title). */
export function csvFilename(title: string | null | undefined): string {
  const clean = (title ?? '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim()
  return `${clean || 'Table'}.csv`
}

/** Save `text` as `filename`. */
export function downloadCsv(text: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** "Export as CSV" for the table at `tablePos`. */
export function exportTableCsv(editor: Editor, tablePos: number): boolean {
  const table = tableAt(editor.state.doc, tablePos)
  if (!table) return false
  downloadCsv(tableToCsv(table), csvFilename(editorObjectTitle(editor)))
  return true
}
