/**
 * `dataViewEmbed` (M8): a collection or query embedded as a live view, a line
 * that is exactly `![[collection:<id>]]` or `![[query:<id>]]` (our choice),
 * optionally preceded by `<!-- block: details -->` for "Show details"
 * (`showDataViewDetails`). Attributes `kind`, `id` and `label` (an optional
 * `|label`, kept as written).
 *
 * Plain rendering here (a muted line naming what it embeds); Task 30 draws the
 * live view.
 */
import { Node, mergeAttributes } from '@tiptap/core'
import type { DataViewKind } from '../annotations'
import { insertBlockNode } from './containers'

export function dataViewEmbedMarkdown(kind: string, id: string, label?: string | null): string {
  return label ? `![[${kind}:${id}|${label}]]` : `![[${kind}:${id}]]`
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    dataViewEmbed: {
      /** Embed the collection or query `id` below the current block. */
      insertDataViewEmbed: (kind: DataViewKind, id: string) => ReturnType
    }
  }
}

export const DataViewEmbed = Node.create({
  name: 'dataViewEmbed',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      kind: {
        default: 'collection',
        parseHTML: (el: HTMLElement) => el.getAttribute('data-kind') ?? 'collection',
        renderHTML: (attrs: { kind: string }) => ({ 'data-kind': attrs.kind }),
      },
      id: {
        default: '',
        parseHTML: (el: HTMLElement) => el.getAttribute('data-view-id') ?? '',
        renderHTML: (attrs: { id: string }) => ({ 'data-view-id': attrs.id }),
      },
      label: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-label'),
        renderHTML: (attrs: { label: string | null }) => (attrs.label ? { 'data-label': attrs.label } : {}),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-data-view]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-data-view': '', class: 'data-view-embed', contenteditable: 'false' }),
      node.attrs.label || `${node.attrs.kind}: ${node.attrs.id}`,
    ]
  },

  renderText({ node }) {
    return dataViewEmbedMarkdown(node.attrs.kind, node.attrs.id, node.attrs.label)
  },

  renderMarkdown(node: { attrs?: { kind?: string; id?: string; label?: string | null } }) {
    return dataViewEmbedMarkdown(node.attrs?.kind ?? 'collection', node.attrs?.id ?? '', node.attrs?.label)
  },

  addCommands() {
    return {
      insertDataViewEmbed:
        (kind, id) =>
        ({ tr, state, dispatch }) => {
          if (!id) return false
          if (!dispatch) return true
          insertBlockNode(tr, state.schema.nodes.dataViewEmbed.create({ kind, id, label: null }))
          return true
        },
    }
  },
})
