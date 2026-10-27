/**
 * Formula cells. A table cell whose text starts with `=` shows the value its
 * formula computes (`formulas.ts`), or the error's title with its message as
 * the tooltip. While the caret is in the cell it shows the `=…` text instead,
 * with "Formula" (`blocks.simpleTable.formulas.editor.placeholder`) after a
 * bare `=` and the statements list under the cell, filtered by the name being
 * typed ("No options found" when none matches). A statement is picked with a
 * click, or with ArrowUp/ArrowDown and Enter/Tab while a name is typed; it
 * replaces the typed name with `NAME(` (a constant: `NAME`; our choice).
 *
 * Everything here is decorations: the cell's text is the file's text and is
 * never rewritten to show a value.
 */
import type { Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state'
import { TableMap } from '@tiptap/pm/tables'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import {
  FORMULA_CONSTANTS,
  FORMULA_NO_OPTIONS,
  FORMULA_PLACEHOLDER,
  FORMULA_STATEMENTS,
  evaluateGrid,
  formatFormulaValue,
  formulaExpression,
  isFormula,
} from './formulas'
import { cellText, tableGrid } from './tableCommands'

export type Statement = (typeof FORMULA_STATEMENTS)[number]

/** The statements whose name starts with `word` (case-insensitive). */
export function matchingStatements(word: string): Statement[] {
  const w = word.toUpperCase()
  return FORMULA_STATEMENTS.filter((s) => s.name.startsWith(w))
}

export type FormulaFunctionListProps = {
  word: string
  active: number
  onPick: (s: Statement) => void
}

/** The statements list shown under a formula cell being edited. */
export function FormulaFunctionList({ word, active, onPick }: FormulaFunctionListProps) {
  const items = matchingStatements(word)
  return (
    <div className="formula-menu" role="listbox" aria-label="Formula functions">
      {items.length === 0 ? (
        <div className="formula-menu-empty">{FORMULA_NO_OPTIONS}</div>
      ) : (
        items.map((s, i) => (
          <div
            key={s.name}
            role="option"
            aria-selected={i === active}
            className="formula-menu-item"
            data-active={i === active || undefined}
            onMouseDown={(e) => {
              e.preventDefault()
              onPick(s)
            }}
          >
            <span className="formula-menu-name">{s.name}</span>
            <span className="formula-menu-desc">{s.description}</span>
          </div>
        ))
      )}
    </div>
  )
}

// ------------------------------------------------------------------ plugin

/** The formula cell holding the caret, and the statement name typed before the caret. */
type Editing = { cellPos: number; word: string; wordFrom: number; showMenu: boolean; empty: boolean }

type FormulaState = { decos: DecorationSet; editing: Editing | null; active: number }

export const formulaCellsKey = new PluginKey<FormulaState>('formulaCells')

function cellAt(state: EditorState): { pos: number; node: PMNode } | null {
  const { $from, empty } = state.selection
  if (!empty) return null
  for (let d = $from.depth; d >= 1; d--) {
    const node = $from.node(d)
    const role = node.type.spec.tableRole
    if (role === 'cell' || role === 'header_cell') return { pos: $from.before(d), node }
  }
  return null
}

function editingOf(state: EditorState, editable: boolean): Editing | null {
  if (!editable) return null
  const cell = cellAt(state)
  if (!cell || !isFormula(cellText(cell.node))) return null
  const { $from } = state.selection
  const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '￼')
  const expr = formulaExpression(before)
  const word = expr == null ? '' : (/[A-Za-z]*$/.exec(expr)?.[0] ?? '')
  const prev = expr == null ? null : expr.slice(0, expr.length - word.length).trimEnd()
  // The list shows while a name is typed, or where one may start (after `=`, `(`, `,` or an operator).
  const showMenu = prev != null && (word !== '' ? !/[A-Za-z0-9_.]$/.test(prev) : prev === '' || /[+\-*/^(,;]$/.test(prev))
  const empty = (formulaExpression(cellText(cell.node)) ?? '').trim() === ''
  return { cellPos: cell.pos, word, wordFrom: $from.pos - word.length, showMenu, empty }
}

/** Pick `s` for the name being typed in the formula cell holding the caret. */
export function pickStatement(view: EditorView, s: Statement): void {
  const editing = formulaCellsKey.getState(view.state)?.editing
  if (!editing) return
  const text = FORMULA_CONSTANTS.has(s.name) ? s.name : `${s.name}(`
  view.dispatch(view.state.tr.insertText(text, editing.wordFrom, view.state.selection.from))
  view.focus()
}

type MenuHost = HTMLElement & { _root?: Root }

function menuWidget(editing: Editing, active: number) {
  return (view: EditorView): HTMLElement => {
    const el = document.createElement('span') as MenuHost
    el.className = 'formula-menu-anchor'
    el.setAttribute('contenteditable', 'false')
    const root = createRoot(el)
    el._root = root
    root.render(createElement(FormulaFunctionList, { word: editing.word, active, onPick: (s) => pickStatement(view, s) }))
    return el
  }
}

function placeholderWidget(): HTMLElement {
  const el = document.createElement('span')
  el.className = 'formula-placeholder'
  el.setAttribute('contenteditable', 'false')
  el.textContent = FORMULA_PLACEHOLDER
  return el
}

function valueWidget(text: string, message: string | null): () => HTMLElement {
  return () => {
    const el = document.createElement('span')
    el.className = message ? 'formula-value formula-error' : 'formula-value'
    el.setAttribute('contenteditable', 'false')
    el.textContent = text
    if (message) el.title = message
    return el
  }
}

/** End of the first textblock in the cell at `cellPos`. */
function firstBlockEnd(cell: PMNode, cellPos: number): number {
  const first = cell.firstChild
  return first ? cellPos + 2 + first.content.size : cellPos + 1
}

function formulaDecorations(doc: PMNode, editing: Editing | null, active: number): DecorationSet {
  const decos: Decoration[] = []
  doc.descendants((node, pos) => {
    if (node.type.name !== 'table') return !node.isTextblock && !node.isAtom
    const grid = tableGrid(node)
    if (!grid.some((row) => row.some(isFormula))) return false
    const results = evaluateGrid(grid)
    const map = TableMap.get(node)
    for (let row = 0; row < map.height; row++) {
      for (let col = 0; col < map.width; col++) {
        if (!isFormula(grid[row][col])) continue
        const rel = map.map[row * map.width + col]
        const cell = node.nodeAt(rel)
        if (!cell) continue
        const cellPos = pos + 1 + rel
        const end = firstBlockEnd(cell, cellPos)
        if (editing && editing.cellPos === cellPos) {
          decos.push(Decoration.node(cellPos, cellPos + cell.nodeSize, { class: 'formula-cell', 'data-formula': 'editing' }))
          if (editing.empty) decos.push(Decoration.widget(end, placeholderWidget, { side: 1, key: 'formula-placeholder' }))
          if (editing.showMenu) {
            decos.push(
              Decoration.widget(end, menuWidget(editing, active), {
                side: 2,
                key: `formula-menu:${editing.word}:${active}`,
                ignoreSelection: true,
                stopEvent: () => true,
                destroy: (dom) => {
                  const root = (dom as MenuHost)._root
                  if (root) queueMicrotask(() => root.unmount())
                },
              }),
            )
          }
          continue
        }
        const r = results[row][col]!
        const shown = r.ok ? formatFormulaValue(r.value) : r.error.title
        decos.push(
          Decoration.node(cellPos, cellPos + cell.nodeSize, { class: 'formula-cell', 'data-formula': r.ok ? 'value' : 'error' }),
        )
        if (cell.content.size > 2) decos.push(Decoration.inline(cellPos + 1, cellPos + cell.nodeSize - 1, { class: 'formula-source' }))
        decos.push(
          Decoration.widget(end, valueWidget(shown, r.ok ? null : r.error.message), {
            side: 1,
            key: `formula-value:${shown}:${r.ok ? '' : r.error.message}`,
          }),
        )
      }
    }
    return false
  })
  return DecorationSet.create(doc, decos)
}

type Meta = { active: number }

function sameEditing(a: Editing | null, b: Editing | null): boolean {
  if (!a || !b) return a === b
  return a.cellPos === b.cellPos && a.word === b.word && a.showMenu === b.showMenu && a.empty === b.empty
}

/** The plugin `TableUi` adds: formula values, the placeholder and the statements list. */
export function formulaCellsPlugin(editor: Editor): Plugin<FormulaState> {
  const editable = () => !editor.isDestroyed && editor.isEditable
  return new Plugin<FormulaState>({
    key: formulaCellsKey,
    state: {
      init: (_, state) => {
        const editing = editingOf(state, editable())
        return { decos: formulaDecorations(state.doc, editing, 0), editing, active: 0 }
      },
      apply: (tr: Transaction, old, _oldState, state) => {
        const meta = tr.getMeta(formulaCellsKey) as Meta | undefined
        const editing = editingOf(state, editable())
        if (!tr.docChanged && !meta && sameEditing(old.editing, editing)) {
          return { ...old, editing, decos: old.decos.map(tr.mapping, tr.doc) }
        }
        const active = meta ? meta.active : sameEditing(old.editing, editing) ? old.active : 0
        return { decos: formulaDecorations(state.doc, editing, active), editing, active }
      },
    },
    props: {
      decorations: (state) => formulaCellsKey.getState(state)?.decos,
      handleKeyDown: (view, event) => {
        const st = formulaCellsKey.getState(view.state)
        const editing = st?.editing
        if (!st || !editing?.showMenu || editing.word === '') return false
        const items = matchingStatements(editing.word)
        if (!items.length) return false
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          const step = event.key === 'ArrowDown' ? 1 : -1
          const active = (st.active + step + items.length) % items.length
          view.dispatch(view.state.tr.setMeta(formulaCellsKey, { active } satisfies Meta))
          return true
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          pickStatement(view, items[Math.min(st.active, items.length - 1)])
          return true
        }
        return false
      },
    },
  })
}
