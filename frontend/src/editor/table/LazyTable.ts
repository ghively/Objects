/**
 * Tables that render lazily (audit 2026-11-01 P8). A table with more than
 * `LAZY_TABLE_ROWS` rows is drawn as a static preview (its header, the first
 * rows and "Show all N rows") with no editable content until it is expanded:
 * by a click, by the caret entering it, or by scrolling it into view. Rendering
 * every cell of a 1 MB, 300-table body blocked the editor for seconds; the
 * previews cost a few rows each.
 *
 * Expansion is view state, not document state: the `lazyTable` plugin keeps a
 * node decoration on each expanded table, mapped through every transaction.
 * The decoration's arrival makes ProseMirror recreate the node view, now as
 * the stock `TableView` with a `contentDOM`. The file's Markdown never changes
 * for it, and nothing is saved.
 */
import type { NodeViewRendererProps } from '@tiptap/core'
import { Table, TableView } from '@tiptap/extension-table'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, Selection, type EditorState, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView, type NodeView } from '@tiptap/pm/view'
import { cellText } from './tableCommands'

/** Tables with more rows than this start as a preview. */
export const LAZY_TABLE_ROWS = 20
/** Rows the preview shows (the header row included). */
export const PREVIEW_ROWS = 6

export const lazyTableKey = new PluginKey<DecorationSet>('lazyTable')

type Meta = { expand: number }

export function isLazyTable(node: PMNode): boolean {
  return node.type.name === 'table' && node.childCount > LAZY_TABLE_ROWS
}

/** Is the table at `pos` drawn in full (expanded, or small enough never to be lazy)? */
export function isTableExpanded(state: EditorState, pos: number): boolean {
  const node = state.doc.nodeAt(pos)
  if (!node || !isLazyTable(node)) return true
  return (lazyTableKey.getState(state)?.find(pos, pos + node.nodeSize).length ?? 0) > 0
}

/** Expand the table at `pos` (a meta-only transaction: no document change, nothing saved). */
export function expandTable(view: EditorView, pos: number): void {
  if (isTableExpanded(view.state, pos)) return
  view.dispatch(view.state.tr.setMeta(lazyTableKey, { expand: pos } satisfies Meta))
}

/** The table holding the selection's start, as a top-level or container child, or null. */
function selectionTable(state: EditorState): number | null {
  const { $from } = state.selection
  for (let d = $from.depth; d >= 1; d--) if ($from.node(d).type.name === 'table') return $from.before(d)
  return null
}

function expandedDecoration(doc: PMNode, pos: number): Decoration | null {
  const node = doc.nodeAt(pos)
  if (!node || node.type.name !== 'table') return null
  return Decoration.node(pos, pos + node.nodeSize, { 'data-table-expanded': '' }, { expanded: true })
}

/** The static preview of a big table, until it is expanded. */
class TablePreviewView implements NodeView {
  dom: HTMLElement
  private node: PMNode
  private view: EditorView
  private getPos: () => number | undefined
  private observer: IntersectionObserver | null = null

  constructor(node: PMNode, view: EditorView, getPos: () => number | undefined) {
    this.node = node
    this.view = view
    this.getPos = getPos
    this.dom = document.createElement('div')
    this.dom.className = 'tableWrapper table-preview'
    this.dom.contentEditable = 'false'
    this.render()
    this.dom.addEventListener('click', this.onClick)
    if (typeof IntersectionObserver !== 'undefined') {
      this.observer = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) this.expand()
      })
      this.observer.observe(this.dom)
    }
  }

  private onClick = (event: MouseEvent) => {
    event.preventDefault()
    this.expand(true)
  }

  private expand(focus = false): void {
    const pos = this.getPos()
    if (pos == null || this.view.isDestroyed) return
    const tr = this.view.state.tr.setMeta(lazyTableKey, { expand: pos } satisfies Meta)
    if (focus) tr.setSelection(Selection.near(tr.doc.resolve(pos + 1)))
    this.view.dispatch(tr)
    if (focus) this.view.focus()
  }

  private render(): void {
    const table = document.createElement('table')
    const body = table.appendChild(document.createElement('tbody'))
    const rows = Math.min(PREVIEW_ROWS, this.node.childCount)
    for (let r = 0; r < rows; r++) {
      const row = this.node.child(r)
      const tr = body.appendChild(document.createElement('tr'))
      row.forEach((cell) => {
        const el = tr.appendChild(document.createElement(cell.type.spec.tableRole === 'header_cell' ? 'th' : 'td'))
        if (cell.attrs.colspan > 1) el.colSpan = cell.attrs.colspan
        el.textContent = cellText(cell)
      })
    }
    const more = document.createElement('button')
    more.type = 'button'
    more.className = 'table-preview-more'
    more.textContent = `Show all ${this.node.childCount.toLocaleString()} rows`
    this.dom.replaceChildren(table, more)
  }

  update(node: PMNode, decorations: readonly Decoration[]): boolean {
    if (node.type !== this.node.type) return false
    // Expanded (the plugin's decoration arrived) or small again: the stock view takes over.
    if (decorations.some((d) => (d.spec as { expanded?: boolean }).expanded) || !isLazyTable(node)) return false
    if (node !== this.node) {
      this.node = node
      this.render()
    }
    return true
  }

  selectNode(): void {
    this.dom.classList.add('ProseMirror-selectednode')
  }

  deselectNode(): void {
    this.dom.classList.remove('ProseMirror-selectednode')
  }

  stopEvent(): boolean {
    return true
  }

  ignoreMutation(): boolean {
    return true
  }

  destroy(): void {
    this.observer?.disconnect()
    this.dom.removeEventListener('click', this.onClick)
  }
}

/**
 * `Table` with lazy views (`TableKit` is configured without its own table).
 * `resizable` stays off, as before: the expanded view is `TableView` as the
 * kit would create it.
 */
export const LazyTable = Table.extend({
  addNodeView() {
    const { cellMinWidth, HTMLAttributes } = this.options
    return ({ node, view, getPos, decorations, HTMLAttributes: attrs }: NodeViewRendererProps) => {
      const expanded = decorations.some((d) => (d.spec as { expanded?: boolean }).expanded)
      if (!isLazyTable(node) || expanded) return new TableView(node, cellMinWidth, view, { ...HTMLAttributes, ...attrs })
      return new TablePreviewView(node, view, getPos as () => number | undefined)
    }
  },

  addProseMirrorPlugins() {
    return [
      ...(this.parent?.() ?? []),
      new Plugin<DecorationSet>({
        key: lazyTableKey,
        state: {
          init: () => DecorationSet.empty,
          apply: (tr: Transaction, old, _oldState, state) => {
            let set = tr.docChanged ? old.map(tr.mapping, tr.doc) : old
            const meta = tr.getMeta(lazyTableKey) as Meta | undefined
            // Asked for, or entered by the caret (a search hit, a keyboard move).
            const at = meta?.expand ?? (tr.selectionSet ? selectionTable(state) : null)
            if (at != null && set.find(at, at + 1).length === 0) {
              const deco = expandedDecoration(tr.doc, at)
              if (deco) set = set.add(tr.doc, [deco])
            }
            return set
          },
        },
        props: {
          decorations: (state) => lazyTableKey.getState(state),
        },
      }),
    ]
  },
})
