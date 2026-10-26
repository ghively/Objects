import { useEffect, useRef, useState } from 'react'
import { Icon } from '@/components/Icon'
import { placeholderFor } from '../format'
import type { CellProps } from './types'

const SEPARATOR_ROW = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/

function splitRow(line: string): string[] {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1)
  const cells: string[] = []
  let cur = ''
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') {
      cur += '|'
      i++
    } else if (s[i] === '|') {
      cells.push(cur.trim())
      cur = ''
    } else cur += s[i]
  }
  cells.push(cur.trim())
  return cells
}

/** A GFM table's cells, header row first, every row padded to the widest; `[]` for no table. */
export function parseGfmTable(md: string | null | undefined): string[][] {
  if (!md) return []
  const rows = md
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '' && !SEPARATOR_ROW.test(l))
    .map(splitRow)
  const width = Math.max(0, ...rows.map((r) => r.length))
  return rows.map((r) => [...r, ...Array<string>(width - r.length).fill('')])
}

/** Cells as a GFM table: the first row is the header, `|` in a cell is escaped. */
export function serializeGfmTable(rows: string[][]): string {
  if (!rows.length) return ''
  const line = (r: string[]) =>
    `| ${r.map((c) => c.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|')).join(' | ')} |`
  const width = rows[0].length
  return [line(rows[0]), `| ${Array<string>(width).fill('---').join(' | ')} |`, ...rows.slice(1).map(line)].join(
    '\n',
  )
}

const isBlank = (rows: string[][]) => rows.every((r) => r.every((c) => c.trim() === ''))

const SMALL_BTN = 'flex items-center gap-1 rounded px-1.5 text-[13px] text-fg-muted hover:bg-hover hover:text-fg'

/**
 * A simple table (`simpleTableBlock`), stored as a GFM table. Each cell is an input; leaving a
 * cell saves the whole table. "Add row" and "Add column" grow it. An empty cell shows the
 * placeholder, and "Add table" starts a 2×2 table (saved once a cell has text).
 */
export function SimpleTableCell({ def, value, readOnly, density, inTable, onChange }: CellProps<string | null>) {
  const [rows, setRows] = useState(() => parseGfmTable(value))
  const editing = useRef(false)
  useEffect(() => {
    if (!editing.current) setRows(parseGfmTable(value))
  }, [value])

  const commit = (next: string[][]) => {
    editing.current = false
    const out = isBlank(next) ? null : serializeGfmTable(next)
    if (out !== (value || null)) onChange(out)
  }

  if (!rows.length) {
    return (
      <div className="flex items-center gap-2 text-[15px]">
        <span className="text-fg-muted">{placeholderFor(def, inTable ? 'table' : density)}</span>
        {!readOnly && (
          <button
            type="button"
            onClick={() =>
              setRows([
                ['', ''],
                ['', ''],
              ])
            }
            className={SMALL_BTN}
          >
            Add table
          </button>
        )}
      </div>
    )
  }

  const setCell = (r: number, c: number, text: string) =>
    setRows((prev) => prev.map((row, i) => (i === r ? row.map((cell, j) => (j === c ? text : cell)) : row)))

  return (
    <div className="overflow-x-auto">
      <table className="border-collapse text-[14px]">
        <tbody>
          {rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, c) => (
                <td key={c} className="border border-line p-0">
                  <input
                    aria-label={`Row ${r + 1}, column ${c + 1}`}
                    value={cell}
                    readOnly={readOnly}
                    onFocus={() => (editing.current = true)}
                    onChange={(e) => setCell(r, c, e.target.value)}
                    onBlur={() => {
                      if (!readOnly) commit(rows)
                    }}
                    className={`w-28 bg-transparent px-2 py-1 text-fg outline-none ${r === 0 ? 'font-medium' : ''}`}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!readOnly && (
        <div className="mt-1 flex gap-2">
          <button
            type="button"
            onClick={() => setRows((prev) => [...prev, Array<string>(prev[0].length).fill('')])}
            className={SMALL_BTN}
          >
            <Icon name="ph-plus" size={12} /> Add row
          </button>
          <button type="button" onClick={() => setRows((prev) => prev.map((row) => [...row, '']))} className={SMALL_BTN}>
            <Icon name="ph-plus" size={12} /> Add column
          </button>
        </div>
      )}
    </div>
  )
}
