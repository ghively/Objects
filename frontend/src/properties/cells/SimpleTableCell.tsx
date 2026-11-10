import { useEffect, useRef, useState } from 'react'
import { Icon } from '@/components/Icon'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { placeholderFor } from '../format'
import type { CellProps } from './types'

const SEPARATOR_ROW = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/

/** A cell's text as GFM shows it: `\|` is `|`, then a `\` before ASCII punctuation drops. */
const unescapeCell = (raw: string) =>
  raw
    .trim()
    .replace(/\\\|/g, '|')
    .replace(/\\([!-/:-@[-`{-~])/g, '$1')

/** A row's cells. As in GFM, a `|` right after a `\` is part of the cell. */
function splitRow(line: string): string[] {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1)
  const cells: string[] = []
  let start = 0
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '|' && s[i - 1] !== '\\') {
      cells.push(s.slice(start, i))
      start = i + 1
    }
  }
  cells.push(s.slice(start))
  return cells.map(unescapeCell)
}

/**
 * A GFM table's cells, header row first, every row padded to the widest; `[]` for no table. Only
 * line 2 is the separator (a later line of dashes is a row); cells are unescaped as GFM shows them.
 * The backend's `table_rows` reads the same way.
 */
export function parseGfmTable(md: string | null | undefined): string[][] {
  if (!md) return []
  const lines = md
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '')
  const rows = lines.filter((l, i) => i !== 1 || !SEPARATOR_ROW.test(l)).map(splitRow)
  const width = Math.max(0, ...rows.map((r) => r.length))
  return rows.map((r) => [...r, ...Array<string>(width - r.length).fill('')])
}

/**
 * A cell for a GFM row: `\` and `|` escaped, and a cell of dashes (`-`, `:--:`) escaped (`\-`) so
 * it can't read as a separator; GFM shows each as typed. The backend's `table_markdown` matches.
 */
const escapeCell = (c: string) =>
  c
    .replace(/\r?\n/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/^(\s*)(:?-+:?\s*)$/, '$1\\$2')

/** Cells as a GFM table: the first row is the header; cells escaped (`escapeCell`). */
export function serializeGfmTable(rows: string[][]): string {
  if (!rows.length || !rows[0].length) return ''
  const line = (r: string[]) => `| ${r.map(escapeCell).join(' | ')} |`
  const width = rows[0].length
  return [line(rows[0]), `| ${Array<string>(width).fill('---').join(' | ')} |`, ...rows.slice(1).map(line)].join(
    '\n',
  )
}

/** M31: what a table view or card shows for a table: its body rows, "1 row" / "N rows" (our strings). */
export function tableSummary(rows: string[][]): string {
  const n = Math.max(0, rows.length - 1)
  return n === 1 ? '1 row' : `${n} rows`
}

const isBlank = (rows: string[][]) => rows.every((r) => r.every((c) => c.trim() === ''))

const SMALL_BTN = 'flex items-center gap-1 rounded px-1.5 text-[13px] text-fg-muted hover:bg-hover hover:text-fg'
const REMOVE_BTN =
  'flex size-5 shrink-0 items-center justify-center rounded text-fg-muted opacity-0 hover:bg-hover hover:text-fg focus-visible:opacity-100 group-hover/table:opacity-100'

/**
 * The table itself: the header row (column names) as header cells, then the rows; with the
 * property's "First column is a header" (`options.headerColumn`) each row's first cell is a row
 * header too (display only: the stored table is the same). Editable: each cell is an input,
 * leaving a cell saves the whole table; "Add row" and "Add column" grow it and the × buttons
 * remove a row (never the header row) or a column, each saved at once.
 */
function TableEditor({
  def,
  rows,
  setRows,
  readOnly,
  onCommit,
  onFocusCell,
}: {
  def: CellProps<string | null>['def']
  rows: string[][]
  setRows(next: (prev: string[][]) => string[][]): void
  readOnly?: boolean
  onCommit(next: string[][]): void
  onFocusCell(): void
}) {
  const setCell = (r: number, c: number, text: string) =>
    setRows((prev) => prev.map((row, i) => (i === r ? row.map((cell, j) => (j === c ? text : cell)) : row)))
  const change = (changed: string[][]) => {
    const next = changed[0]?.length ? changed : [] // no column left: no table
    setRows(() => next)
    onCommit(next)
  }
  const width = rows[0]?.length ?? 0
  const headerColumn = def.options.headerColumn === true

  return (
    <div className="group/table overflow-x-auto">
      <table aria-label={def.name} className="border-collapse text-[14px]">
        <tbody>
          {rows.map((row, r) => {
            return (
              <tr key={r}>
                {row.map((cell, c) => {
                  const rowHeader = r > 0 && c === 0 && headerColumn
                  const header = r === 0 || rowHeader
                  const Cell = header ? 'th' : 'td'
                  return (
                    <Cell
                      key={c}
                      scope={r === 0 ? 'col' : rowHeader ? 'row' : undefined}
                      className={cn('border border-line p-0 text-left align-top', header && 'bg-hover font-medium')}
                    >
                      {readOnly ? (
                        <span className="block min-w-16 px-2 py-1 text-fg">{cell}</span>
                      ) : (
                        <span className="flex items-center">
                          <input
                            aria-label={`Row ${r + 1}, column ${c + 1}`}
                            value={cell}
                            onFocus={onFocusCell}
                            onChange={(e) => setCell(r, c, e.target.value)}
                            onBlur={() => onCommit(rows)}
                            className={cn('w-28 min-w-0 flex-1 bg-transparent px-2 py-1 text-fg outline-none', header && 'font-medium')}
                          />
                          {r === 0 && (
                            <button
                              type="button"
                              aria-label={`Remove column ${c + 1}`}
                              title="Remove column"
                              onClick={() => change(rows.map((x) => x.filter((_, j) => j !== c)))}
                              className={cn(REMOVE_BTN, 'mr-0.5')}
                            >
                              <Icon name="ph-x" size={11} />
                            </button>
                          )}
                        </span>
                      )}
                    </Cell>
                  )
                })}
                {!readOnly && (
                  <td className="w-6 border-0 p-0 pl-0.5 align-middle">
                    {r > 0 && (
                      <button
                        type="button"
                        aria-label={`Remove row ${r + 1}`}
                        title="Remove row"
                        onClick={() => change(rows.filter((_, i) => i !== r))}
                        className={REMOVE_BTN}
                      >
                        <Icon name="ph-x" size={11} />
                      </button>
                    )}
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
      {!readOnly && (
        <div className="mt-1 flex gap-2">
          <button type="button" onClick={() => change([...rows, Array<string>(width).fill('')])} className={SMALL_BTN}>
            <Icon name="ph-plus" size={12} /> Add row
          </button>
          <button type="button" onClick={() => change(rows.map((row) => [...row, '']))} className={SMALL_BTN}>
            <Icon name="ph-plus" size={12} /> Add column
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * A simple table (`simpleTableBlock`, "Table"), stored as a GFM table (the header row first). In
 * the property panel it is the table to edit; an empty one shows the placeholder and "Add table",
 * which starts a 2×2 table (saved once a cell has text). M31: in a table view or on a card it is
 * "N rows" (its column names on hover); in a table view that opens the table in a peek.
 */
export function SimpleTableCell({ def, value, readOnly, density, inTable, onChange }: CellProps<string | null>) {
  const [rows, setRows] = useState(() => parseGfmTable(value))
  const editing = useRef(false)
  useEffect(() => {
    if (!editing.current) setRows(parseGfmTable(value))
  }, [value])

  const commit = (next: string[][]) => {
    editing.current = false
    const out = isBlank(next) || !next[0]?.length ? null : serializeGfmTable(next)
    if (out !== (value || null)) void onChange(out)
  }

  const editor = (
    <TableEditor
      def={def}
      rows={rows}
      setRows={(fn) => setRows(fn)}
      readOnly={readOnly}
      onCommit={commit}
      onFocusCell={() => (editing.current = true)}
    />
  )

  if (density === 'table' || inTable) {
    const saved = parseGfmTable(value)
    if (!saved.length) return inTable ? null : <span className="text-[13px] text-fg-muted">{placeholderFor(def, density)}</span>
    const pill = (
      <span className="inline-flex max-w-full items-center gap-1 truncate text-[14px] text-fg">
        <Icon name="ph-table" size={13} className="shrink-0 text-fg-muted" />
        {tableSummary(saved)}
      </span>
    )
    const columns = saved[0].filter((c) => c.trim()).join(', ')
    if (!inTable) return <span title={columns}>{pill}</span>
    return (
      <Popover
        onOpenChange={(open) => {
          if (open) setRows(saved)
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            title={columns}
            aria-label={tableSummary(saved)}
            className="flex max-w-full items-center rounded px-1 text-left hover:bg-hover"
          >
            {pill}
          </button>
        </PopoverTrigger>
        <PopoverContent
          aria-label={def.name}
          align="start"
          className="w-auto max-w-[min(90vw,720px)] border-line bg-raised p-2 text-fg"
        >
          {editor}
        </PopoverContent>
      </Popover>
    )
  }

  if (!rows.length) {
    return (
      <div className="flex items-center gap-2 text-[15px]">
        <span className="text-fg-muted">{placeholderFor(def, density)}</span>
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

  return editor
}
