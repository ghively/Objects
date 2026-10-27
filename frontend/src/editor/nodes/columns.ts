/**
 * `columns` and `column`: Object's `GridBlock` ("Two Columns"). In the file:
 *
 *   <!-- columns widths=40,60 -->
 *   Left side text.
 *   <!-- column -->
 *   Right side text.
 *   <!-- /columns -->
 *
 * Container options: `widths` (integers summing to 100), `layout=grid`, `color`.
 * Each `column` keeps its raw separator line (`null` for the first). Rendering
 * is a plain `div` per container and column here; Task 10 adds the views.
 */
import { Node, mergeAttributes } from '@tiptap/core'
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
    }
  }
}

export const MAX_COLUMNS = 6

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
    }
  },
})
