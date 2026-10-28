/**
 * Source tracking for blocks, at the top level and inside containers.
 *
 * Every node loaded from a `SourceBlock` (or a container region) carries:
 * - `blockSource`: the block's original `raw` text (for a container or a
 *   column, its whole region), cleared as soon as the node changes. A node
 *   that still has it is emitted byte-for-byte on save.
 * - `blockOrigin`: the same raw text, kept after edits so `preserveBlock` can
 *   still align table rows / list items and keep the original style.
 * - `blockTrailing`: the blank-line (`space`) source that followed the block.
 *
 * None of them render to the DOM or survive a split.
 *
 * Keep rule (M7): a node whose content and non-source attributes equal the
 * snapshot taken at load keeps, or regains, its `blockSource`. This is what
 * makes undo and block moves byte-exact. An edit inside a container clears the
 * container's `blockSource` and the edited child's, never the siblings'.
 */
import { Extension, type Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { Transaction } from '@tiptap/pm/state'

/** Containers and columns: the clearing plugin descends into these only. */
export const CONTAINER_TYPES = ['toggle', 'group', 'columns', 'column', 'indent']

/** Node types that can be loaded from source (top level or inside a container). */
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
  'mathBlock',
  'media',
  'objectEmbed',
  'bookmark',
  // M8
  'blockRef',
  'dataViewEmbed',
  ...CONTAINER_TYPES,
]

/** Transactions carrying this meta never clear `blockSource` (document loads, our own clears). */
export const BLOCK_SOURCE_META = 'blockSourceInternal'

const sourceAttr = {
  default: null,
  rendered: false,
  keepOnSplit: false,
}

const CONTAINERS = new Set(CONTAINER_TYPES)

// ---------------------------------------------------------------------------
// Load snapshots (the keep rule)

const snapshots = new WeakMap<Editor, Map<string, PMNode[]>>()

/** Attributes left out of the "content" comparison (an option change only). */
const OPTION_ATTRS = new Set(['blockSource', 'blockOptions', 'blockAnnotation', 'blockTrailing'])
const SOURCE_ONLY = new Set(['blockSource'])

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a == null || b == null || typeof a !== 'object' || typeof b !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const ka = Object.keys(a as object)
  const kb = Object.keys(b as object)
  if (ka.length !== kb.length) return false
  return ka.every((k) => sameValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
}

function sameAttrs(a: PMNode, b: PMNode, skip: Set<string>): boolean {
  for (const k of Object.keys(a.attrs)) {
    if (skip.has(k)) continue
    if (!sameValue(a.attrs[k], b.attrs[k])) return false
  }
  return true
}

/**
 * `a` equals the loaded node `b`, `blockSource` aside (at every level of a
 * container); with `contentOnly`, the top node's options and trailing aside too.
 */
function sameAsLoaded(a: PMNode, b: PMNode, contentOnly: boolean): boolean {
  if (a === b) return true
  if (a.type !== b.type || !sameAttrs(a, b, contentOnly ? OPTION_ATTRS : SOURCE_ONLY)) return false
  if (!CONTAINERS.has(a.type.name)) return a.content.eq(b.content)
  if (a.childCount !== b.childCount) return false
  for (let i = 0; i < a.childCount; i++) if (!sameAsLoaded(a.child(i), b.child(i), false)) return false
  return true
}

/** Record every source-tracked node of a freshly loaded document (references only). */
export function takeSnapshots(editor: Editor, doc: PMNode): void {
  const map = new Map<string, PMNode[]>()
  doc.descendants((node) => {
    const origin = node.attrs.blockOrigin as string | null | undefined
    if (origin != null) {
      const list = map.get(origin)
      if (list) list.push(node)
      else map.set(origin, [node])
    }
    return CONTAINERS.has(node.type.name)
  })
  snapshots.set(editor, map)
}

function matches(editor: Editor, node: PMNode, contentOnly: boolean): boolean {
  const origin = node.attrs.blockOrigin as string | null | undefined
  if (origin == null) return false
  return snapshots.get(editor)?.get(origin)?.some((loaded) => sameAsLoaded(node, loaded, contentOnly)) ?? false
}

/** The node equals one loaded from its `blockOrigin` (content and every non-source attribute). */
export function matchesSnapshot(editor: Editor, node: PMNode): boolean {
  return matches(editor, node, false)
}

/** The node's content equals one loaded from its `blockOrigin`; only its options may differ. */
export function contentMatchesSnapshot(editor: Editor, node: PMNode): boolean {
  return matches(editor, node, true)
}

// ---------------------------------------------------------------------------

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
    const editor = this.editor
    return [
      new Plugin({
        key: new PluginKey('blockSource'),
        appendTransaction(trs, _oldState, newState) {
          const ranges = changedRanges(trs)
          if (ranges.length === 0) return null
          const tr = newState.tr
          newState.doc.descendants((node, pos) => {
            const start = pos
            const end = pos + node.nodeSize
            // A zero-width range strictly inside the node (a deletion or a join) counts too.
            const touched = ranges.some(([f, t]) => (f < end && t > start) || (f === t && f > start && f < end))
            if (!touched) return false
            const origin = node.attrs.blockOrigin as string | null | undefined
            if (origin != null) {
              const want = matchesSnapshot(editor, node) ? origin : null
              if ((node.attrs.blockSource ?? null) !== want) tr.setNodeAttribute(pos, 'blockSource', want)
            }
            return CONTAINERS.has(node.type.name)
          })
          if (!tr.docChanged) return null
          return tr.setMeta(BLOCK_SOURCE_META, true)
        },
      }),
    ]
  },
})
