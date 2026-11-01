/**
 * `columns` and `column`: Capacities' `GridBlock` ("Two Columns"). In the file:
 *
 *   <!-- columns widths=40,60 -->
 *   Left side text.
 *   <!-- column -->
 *   Right side text.
 *   <!-- /columns -->
 *
 * Container options: `widths` (integers summing to 100), `layout=grid`, `color`.
 * Each `column` keeps its raw separator line (`null` for the first).
 *
 * Task 10: the node view (`layout/ColumnsView.tsx`: a CSS grid with one track
 * per column at its `widths`, the dividers, "Column layout", "Add column" and
 * "Remove column"), the commands behind it, and the empty-column placeholder.
 * This module also brings in `TableUi` (`table/TableMenu.tsx`), the table
 * menus and header display, so the table UI needs no change to the editor's
 * extension list (`document.ts`, owned by the document model).
 */
import { Node, mergeAttributes } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, type DecorationSet } from '@tiptap/pm/view'
import { buildDecorations, updateDecorations, type DecorationVisitor } from '../extensions/incrementalDecorations'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { ColumnsView } from '../layout/ColumnsView'
import { MAX_COLUMNS } from '../layout/Divider'
import { TableUi } from '../table/TableMenu'
import { containerSourceAttributes } from './containers'
import { blockChain, setOptionAt } from './blockOptions'
import './columns.css'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    columns: {
      /** Insert a columns block with `n` (1-6) empty columns below the current block. */
      insertColumns: (n?: number) => ReturnType
      /** Write the `widths` option of the columns block at `pos` (`null` or `[]` removes it). */
      setColumnWidths: (pos: number, widths: number[] | null) => ReturnType
      /** "Column layout": `grid` writes `layout=grid`, `columns` removes it. */
      setColumnsLayout: (pos: number, layout: 'columns' | 'grid') => ReturnType
      /** "Add column": append an empty column (up to 6); widths go back to even. */
      addColumn: (pos: number) => ReturnType
      /**
       * "Remove column": remove the last column (down to 1), moving its blocks
       * to the end of the column before it; widths go back to even.
       */
      removeColumn: (pos: number) => ReturnType
    }
  }
}

export { MAX_COLUMNS }

const emptyColumnKey = new PluginKey<DecorationSet>('emptyColumn')

/** Mark the lone empty paragraph of each empty column, so it shows a placeholder line. */
const emptyColumnVisitor: DecorationVisitor = (node, pos, decos) => {
  if (node.type.name === 'column') {
    const only = node.childCount === 1 ? node.firstChild! : null
    if (only && only.type.name === 'paragraph' && only.content.size === 0) {
      decos.push(Decoration.node(pos + 1, pos + 1 + only.nodeSize, { class: 'column-empty', 'data-column-empty': '' }))
    }
  }
  return !node.isTextblock && !node.isAtom
}

export const Column = Node.create({
  name: 'column',
  content: 'block+',
  isolating: true,

  addAttributes() {
    return {
      separator: { default: null, rendered: false, keepOnSplit: false },
      containerLeading: { default: null, rendered: false, keepOnSplit: false },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-column]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-column': '', class: 'block-column' }), 0]
  },

  renderMarkdown(node: { content?: unknown[] }, h: { renderChildren: (c: unknown[], sep: string) => string }) {
    return node.content ? h.renderChildren(node.content, '\n\n') : ''
  },
})

export const Columns = Node.create({
  name: 'columns',
  group: 'block',
  content: 'column{1,6}',
  defining: true,

  addAttributes() {
    return containerSourceAttributes()
  },

  parseHTML() {
    return [{ tag: 'div[data-columns]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-columns': String(node.childCount), class: 'block-columns' }),
      0,
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(ColumnsView)
  },

  addExtensions() {
    return [TableUi]
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: emptyColumnKey,
        state: {
          init: (_, state) => buildDecorations(state.doc, emptyColumnVisitor),
          apply: (tr, old) => updateDecorations(old, tr, emptyColumnVisitor),
        },
        props: {
          decorations: (state) => emptyColumnKey.getState(state),
        },
      }),
    ]
  },

  renderMarkdown(node: { content?: unknown[] }, h: { renderChildren: (c: unknown[], sep: string) => string }) {
    return node.content ? h.renderChildren(node.content, '\n\n') : ''
  },

  addCommands() {
    return {
      insertColumns:
        (n = 2) =>
        ({ tr, state, dispatch }) => {
          const count = Math.max(1, Math.min(MAX_COLUMNS, Math.floor(n)))
          const { column, columns, paragraph } = state.schema.nodes
          const cols = Array.from({ length: count }, () => column.create(null, paragraph.create()))
          const node = columns.create({ blockOptions: [] }, cols)
          if (!dispatch) return true
          const leaf = blockChain(tr)[0]
          const at = leaf ? leaf.pos + leaf.node.nodeSize : tr.doc.content.size
          tr.insert(at, node)
          return true
        },
      setColumnWidths:
        (pos, widths) =>
        ({ tr, dispatch }) => {
          const node = tr.doc.nodeAt(pos)
          if (!node || node.type.name !== 'columns') return false
          const value = widths && widths.length ? widths.map((w) => Math.round(w)).join(',') : null
          if (dispatch) setOptionAt(tr, pos, 'widths', value)
          return true
        },
      setColumnsLayout:
        (pos, layout) =>
        ({ tr, dispatch }) => {
          const node = tr.doc.nodeAt(pos)
          if (!node || node.type.name !== 'columns') return false
          if (dispatch) setOptionAt(tr, pos, 'layout', layout === 'grid' ? 'grid' : null)
          return true
        },
      addColumn:
        (pos) =>
        ({ tr, state, dispatch }) => {
          const node = tr.doc.nodeAt(pos)
          if (!node || node.type.name !== 'columns' || node.childCount >= MAX_COLUMNS) return false
          if (!dispatch) return true
          const { column, paragraph } = state.schema.nodes
          tr.insert(pos + node.nodeSize - 1, column.create(null, paragraph.create()))
          setOptionAt(tr, pos, 'widths', null)
          return true
        },
      removeColumn:
        (pos) =>
        ({ tr, dispatch }) => {
          const node = tr.doc.nodeAt(pos)
          if (!node || node.type.name !== 'columns' || node.childCount <= 1) return false
          if (!dispatch) return true
          const last = node.lastChild!
          const lastPos = pos + node.nodeSize - 1 - last.nodeSize
          const prev = node.child(node.childCount - 2)
          const prevEnd = lastPos - 1
          // Keep every block of the removed column, except one lone empty paragraph.
          const moved: PMNode[] = []
          last.forEach((child) => {
            if (!(last.childCount === 1 && child.type.name === 'paragraph' && child.content.size === 0)) moved.push(child)
          })
          tr.delete(lastPos, lastPos + last.nodeSize)
          if (moved.length) {
            const prevOnlyEmpty = prev.childCount === 1 && prev.firstChild!.type.name === 'paragraph' && prev.firstChild!.content.size === 0
            if (prevOnlyEmpty) tr.replaceWith(prevEnd - prev.firstChild!.nodeSize, prevEnd, moved)
            else {
              // The block that ended the column now has blocks after it: give it
              // a blank line, so the two never run together in the file.
              const tail = prev.lastChild!
              const tailPos = prevEnd - tail.nodeSize
              if ('blockTrailing' in tail.attrs && !tail.attrs.blockTrailing && tail.attrs.blockOrigin) {
                const origin = String(tail.attrs.blockOrigin ?? '')
                // Its source keeps its own line end when it has one; add the blank line.
                const eol = /\r\n$/.test(origin) ? '\r\n' : '\n'
                tr.setNodeAttribute(tailPos, 'blockTrailing', /(?:\r\n|\n)$/.test(origin) ? eol : eol + eol)
              }
              tr.insert(prevEnd, moved)
            }
          }
          setOptionAt(tr, pos, 'widths', null)
          return true
        },
    }
  },
})
