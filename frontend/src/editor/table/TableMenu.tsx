/**
 * The table menus (Capacities' `SimpleTableBlock`), shown on a bar above a
 * table while it is hovered or holds the cursor:
 * - "Edit table" (`blocks.simpleTable.optionsMenu.label`): the "Header row" and
 *   "Header column" switches (`showHeaderRow`, `showHeaderColumn`), "Clear cell
 *   contents" (`clearCellContents`, for the cell holding the cursor) and
 *   "Export as CSV" (`export`, `csv.ts`) and "Delete table" (`deleteTable`);
 * - "Edit row" (`rowMenu.label`): "Insert row above", "Insert row below",
 *   "Delete row", "Clear row";
 * - "Edit column" (`colMenu.label`): "Insert column before", "Insert column
 *   after", "Delete column", "Clear column", then "Sort column ascending" and
 *   "Sort column descending" (`sortColumnAscending`, `sortColumnDescending`;
 *   their place in the menu is our choice).
 * - "Alignment" (M9; `EditorPanel.shortLabels.alignment`): "Align text left", "Text align
 *   center", "Text align right" (`shortcuts.textAlign*.name`), Capacities' table-cell
 *   alignment. A GFM table aligns columns, so it sets the column's alignment (the separator
 *   line's `:-:` / `-:`; our choice). Its place on the bar is our choice.
 * The row, column and alignment menus act on the cell holding the cursor.
 *
 * `TableUi` puts the bar in front of each table as a widget decoration (its
 * React root mounts the first time the table is hovered or entered, so a long
 * page with many tables stays cheap), and marks the cells whose displayed role
 * differs from their Markdown role: with `no-header-row` the first row shows
 * as ordinary cells, with `header-column` the first column shows as header
 * cells (`data-cell-header`). The file's header and separator lines never change.
 * It also carries the formula-cell plugin (`FormulaCell.tsx`).
 */
import { Extension, type Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state'
import { TableMap } from '@tiptap/pm/tables'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import { AlignCenter, AlignLeft, AlignRight, Columns3, Rows3, Table2 } from 'lucide-react'
import { createElement, useEffect, useReducer } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  clearCell,
  clearColumn,
  clearRow,
  columnAlignment,
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
  setColumnAlignment,
  setHeaderRow,
  sortColumn,
  tableAt,
  type CellAlign,
} from './tableCommands'
import { exportTableCsv } from './csv'
import { formulaCellsPlugin } from './FormulaCell'
import './table.css'

/** Re-render on every editor transaction (selection moves included). */
/** Capacities' alignment items, with the bar's icons. */
const ALIGN_ITEMS: readonly { align: CellAlign; name: string; Icon: typeof AlignLeft }[] = [
  { align: 'left', name: 'Align text left', Icon: AlignLeft },
  { align: 'center', name: 'Text align center', Icon: AlignCenter },
  { align: 'right', name: 'Text align right', Icon: AlignRight },
]

function useEditorTick(editor: Editor): void {
  const [, tick] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    editor.on('transaction', tick)
    return () => {
      editor.off('transaction', tick)
    }
  }, [editor])
}

/** A menu row that shows a switch and keeps the menu open. */
function SwitchItem({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <DropdownMenuItem
      role="menuitemcheckbox"
      aria-checked={checked}
      onSelect={(e) => {
        e.preventDefault()
        onChange(!checked)
      }}
    >
      <span className="flex-1">{label}</span>
      <span className="table-menu-switch" data-state={checked ? 'checked' : 'unchecked'} aria-hidden="true">
        <span className="table-menu-switch-thumb" />
      </span>
    </DropdownMenuItem>
  )
}

export type TableMenuProps = {
  editor: Editor
  /** The table's position (the widget's own position, which is the table's). */
  getPos: () => number | undefined
}

export function TableMenu({ editor, getPos }: TableMenuProps) {
  useEditorTick(editor)
  const pos = getPos()
  const table = pos == null ? null : tableAt(editor.state.doc, pos)
  if (pos == null || !table) return null
  const cell = selectedCell(editor.state, pos)
  const headerRow = hasHeaderRow(table)
  const headerColumn = hasHeaderColumn(table)
  const editable = editor.isEditable
  // Each action reads the position afresh: an earlier edit may have moved the table.
  const at = () => getPos() ?? pos
  const align = cell ? columnAlignment(editor.state.doc, pos, cell.col) : 'left'
  const AlignIcon = ALIGN_ITEMS.find((a) => a.align === align)!.Icon

  return (
    <div className="table-menu-bar" role="toolbar">
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild disabled={!editable || !cell}>
          <button type="button" className="table-menu-btn" aria-label="Alignment" title="Alignment">
            <AlignIcon size={14} aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-48">
          <DropdownMenuLabel>Alignment</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={align}
            onValueChange={(v) => cell && setColumnAlignment(editor, at(), cell.col, v as CellAlign)}
          >
            {ALIGN_ITEMS.map(({ align: a, name, Icon }) => (
              <DropdownMenuRadioItem key={a} value={a}>
                <Icon size={14} aria-hidden="true" />
                {name}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild disabled={!editable || !cell}>
          <button type="button" className="table-menu-btn" aria-label="Edit row" title="Edit row">
            <Rows3 size={14} aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-48">
          <DropdownMenuLabel>Edit row</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => cell && insertRowAbove(editor, at(), cell.row)}>Insert row above</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => cell && insertRowBelow(editor, at(), cell.row)}>Insert row below</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => cell && deleteRow(editor, at(), cell.row)}>Delete row</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => cell && clearRow(editor, at(), cell.row)}>Clear row</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild disabled={!editable || !cell}>
          <button type="button" className="table-menu-btn" aria-label="Edit column" title="Edit column">
            <Columns3 size={14} aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-48">
          <DropdownMenuLabel>Edit column</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => cell && insertColumnBefore(editor, at(), cell.col)}>Insert column before</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => cell && insertColumnAfter(editor, at(), cell.col)}>Insert column after</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => cell && deleteColumn(editor, at(), cell.col)}>Delete column</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => cell && clearColumn(editor, at(), cell.col)}>Clear column</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => cell && sortColumn(editor, at(), cell.col, 'asc')}>
            Sort column ascending
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => cell && sortColumn(editor, at(), cell.col, 'desc')}>
            Sort column descending
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild disabled={!editable}>
          <button type="button" className="table-menu-btn" aria-label="Edit table" title="Edit table">
            <Table2 size={14} aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-48">
          <DropdownMenuLabel>Edit table</DropdownMenuLabel>
          <SwitchItem label="Header row" checked={headerRow} onChange={(v) => setHeaderRow(editor, at(), v)} />
          <SwitchItem label="Header column" checked={headerColumn} onChange={(v) => setHeaderColumn(editor, at(), v)} />
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={!cell} onSelect={() => cell && clearCell(editor, at(), cell)}>
            Clear cell contents
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => exportTableCsv(editor, at())}>Export as CSV</DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={() => deleteTable(editor, at())}>
            Delete table
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

// ------------------------------------------------------------------ plugin

type Anchor = HTMLElement & { _activate?: () => void; _root?: Root }

function anchorWidget(editor: Editor) {
  return (_view: EditorView, getPos: () => number | undefined): HTMLElement => {
    const el = document.createElement('div') as Anchor
    el.className = 'table-menu-anchor'
    el.setAttribute('contenteditable', 'false')
    el.setAttribute('data-table-menu', '')
    el._activate = () => {
      if (el._root) return
      // The widget sits right before the table, so its position is the table's.
      const root = createRoot(el)
      el._root = root
      root.render(createElement(TableMenu, { editor, getPos }))
    }
    return el
  }
}

/** Cells whose displayed role differs from their Markdown role. */
function cellDecorations(table: PMNode, tablePos: number, out: Decoration[]): void {
  const headerRow = hasHeaderRow(table)
  const headerColumn = hasHeaderColumn(table)
  if (headerRow && !headerColumn) return
  const map = TableMap.get(table)
  const seen = new Set<number>()
  for (let row = 0; row < map.height; row++) {
    for (let col = 0; col < map.width; col++) {
      const rel = map.map[row * map.width + col]
      if (seen.has(rel)) continue
      seen.add(rel)
      const cell = table.nodeAt(rel)
      if (!cell) continue
      const shown = (row === 0 && headerRow) || (col === 0 && headerColumn)
      const isHeader = cell.type.spec.tableRole === 'header_cell'
      if (shown === isHeader) continue
      const from = tablePos + 1 + rel
      out.push(Decoration.node(from, from + cell.nodeSize, { 'data-cell-header': shown ? 'true' : 'false' }))
    }
  }
}

function tableDecorations(doc: PMNode, editor: Editor): DecorationSet {
  const decos: Decoration[] = []
  let index = 0
  const toDOM = anchorWidget(editor)
  doc.descendants((node, pos) => {
    if (node.type.name === 'table') {
      decos.push(
        Decoration.widget(pos, toDOM, {
          side: -1,
          key: `table-menu-${index++}`,
          ignoreSelection: true,
          stopEvent: () => true,
          destroy: (dom) => {
            const root = (dom as Anchor)._root
            // Unmount outside React's render phase (a widget can go mid-render).
            if (root) queueMicrotask(() => root.unmount())
          },
        }),
      )
      cellDecorations(node, pos, decos)
      return false
    }
    return !node.isTextblock && !node.isAtom
  })
  return DecorationSet.create(doc, decos)
}

/** The table the selection is in, if any. */
function selectionTable(state: EditorState): number | null {
  const $from = state.selection.$from
  for (let d = $from.depth; d >= 1; d--) {
    if ($from.node(d).type.name === 'table') return $from.before(d)
  }
  return null
}

function anchorFor(view: EditorView, tablePos: number): Anchor | null {
  const dom = view.nodeDOM(tablePos) as HTMLElement | null
  const prev = dom?.previousElementSibling as Anchor | null
  return prev && prev.hasAttribute('data-table-menu') ? prev : null
}

export const tableUiKey = new PluginKey<DecorationSet>('tableUi')

export const TableUi = Extension.create({
  name: 'tableUi',

  addProseMirrorPlugins() {
    const editor = this.editor
    let active: Anchor | null = null
    return [
      new Plugin<DecorationSet>({
        key: tableUiKey,
        state: {
          init: (_, state) => tableDecorations(state.doc, editor),
          apply: (tr, old) => (tr.docChanged ? tableDecorations(tr.doc, editor) : old),
        },
        props: {
          decorations: (state) => tableUiKey.getState(state),
          handleDOMEvents: {
            mouseover: (_view, event) => {
              const target = event.target as Element | null
              const wrap = target?.closest?.('.tableWrapper, table')
              const host = wrap?.classList.contains('tableWrapper') ? wrap : wrap?.parentElement
              const anchor = host?.previousElementSibling as Anchor | null
              if (anchor?.hasAttribute('data-table-menu')) anchor._activate?.()
              return false
            },
          },
        },
        view: (view) => {
          const sync = () => {
            const pos = selectionTable(view.state)
            const anchor = pos == null ? null : anchorFor(view, pos)
            if (anchor !== active) {
              active?.removeAttribute('data-active')
              active = anchor
            }
            if (anchor) {
              anchor.setAttribute('data-active', '')
              anchor._activate?.()
            }
          }
          sync()
          return { update: sync, destroy: () => (active = null) }
        },
      }),
      formulaCellsPlugin(editor),
    ]
  },
})
