/**
 * Source tracking for top-level blocks.
 *
 * Every top-level node loaded from a `SourceBlock` carries:
 * - `blockSource`: the block's original `raw` text, cleared as soon as the node
 *   changes. A node that still has it is emitted byte-for-byte on save.
 * - `blockOrigin`: the same raw text, kept after edits so `preserveBlock` can
 *   still align table rows / list items and keep the original style.
 * - `blockTrailing`: the blank-line (`space`) source that followed the block.
 *
 * None of them render to the DOM or survive a split.
 */
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { Transaction } from '@tiptap/pm/state'

/** Node types that can sit at the top level of the document. */
export const TOP_LEVEL_TYPES = [
  'paragraph',
  'heading',
  'bulletList',
  'orderedList',
  'taskList',
  'blockquote',
  'codeBlock',
  'horizontalRule',
  'table',
  'rawBlock',
]

/** Transactions carrying this meta never clear `blockSource` (document loads, our own clears). */
export const BLOCK_SOURCE_META = 'blockSourceInternal'

const sourceAttr = {
  default: null,
  rendered: false,
  keepOnSplit: false,
}

/** Ranges (in the final doc) touched by the given transactions. */
function changedRanges(trs: readonly Transaction[]): [number, number][] {
  const ranges: [number, number][] = []
  trs.forEach((tr, ti) => {
    if (!tr.docChanged || tr.getMeta(BLOCK_SOURCE_META)) return
    tr.steps.forEach((step, si) => {
      const s = step as unknown as { from?: number; to?: number; pos?: number }
      let from: number
      let to: number
      if (typeof s.from === 'number' && typeof s.to === 'number') {
        from = s.from
        to = s.to
      } else if (typeof s.pos === 'number') {
        from = s.pos
        to = s.pos + 1
      } else {
        // Unknown step kind: treat the whole document as touched.
        from = 0
        to = Number.MAX_SAFE_INTEGER
      }
      const rest = tr.mapping.slice(si)
      from = rest.map(from, -1)
      to = to === Number.MAX_SAFE_INTEGER ? to : rest.map(Math.min(to, tr.docs[si].content.size), 1)
      for (let k = ti + 1; k < trs.length; k++) {
        from = trs[k].mapping.map(from, -1)
        if (to !== Number.MAX_SAFE_INTEGER) to = trs[k].mapping.map(to, 1)
      }
      ranges.push([from, Math.max(from, to)])
    })
  })
  return ranges
}

export const BlockSource = Extension.create({
  name: 'blockSource',

  addGlobalAttributes() {
    return [
      {
        types: TOP_LEVEL_TYPES,
        attributes: {
          blockSource: sourceAttr,
          blockOrigin: sourceAttr,
          blockTrailing: sourceAttr,
        },
      },
    ]
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('blockSource'),
        appendTransaction(trs, _oldState, newState) {
          const ranges = changedRanges(trs)
          if (ranges.length === 0) return null
          const tr = newState.tr
          newState.doc.forEach((node, offset) => {
            if (node.attrs.blockSource == null) return
            const start = offset
            const end = offset + node.nodeSize
            // A zero-width range strictly inside the node (a deletion or a join) counts too.
            if (ranges.some(([f, t]) => (f < end && t > start) || (f === t && f > start && f < end))) {
              tr.setNodeAttribute(offset, 'blockSource', null)
            }
          })
          if (!tr.docChanged) return null
          return tr.setMeta(BLOCK_SOURCE_META, true)
        },
      }),
    ]
  },
})
