/**
 * Shared pieces of the container nodes (`toggle`, `group`, `columns`/`column`):
 * the source attributes that let a container round-trip, and the wrap/unwrap
 * transforms their commands use. Owned by the document model (Task 7).
 */
import type { Node as PMNode, NodeType } from '@tiptap/pm/model'
import { NodeSelection, TextSelection, type Transaction } from '@tiptap/pm/state'
import { makeOption, type Option } from '../annotations'
import { BLOCK_PARENTS, blockChain, leafBlockAt } from './blockOptions'

const hidden = { default: null, rendered: false, keepOnSplit: false }

/**
 * `containerOpen` / `containerClose`: the raw open and close lines (with EOL);
 * `containerLeading`: blank lines right after the open (or separator) line.
 */
export function containerSourceAttributes() {
  return {
    containerOpen: hidden,
    containerClose: hidden,
    containerLeading: hidden,
  }
}

/** The sibling blocks the selection covers, in their common block parent. */
export function selectedBlockRange(tr: Transaction): { from: number; to: number; parentDepth: number } | null {
  const { $from, $to } = tr.selection
  const a = leafBlockAt($from)
  const b = leafBlockAt($to)
  if (!a || !b) return null
  const $a = tr.doc.resolve(a.pos)
  const $b = tr.doc.resolve(b.pos)
  if ($a.depth !== $b.depth || $a.parent !== $b.parent) {
    // Different parents: wrap only the block at the cursor.
    return { from: a.pos, to: a.pos + a.node.nodeSize, parentDepth: $a.depth }
  }
  return { from: a.pos, to: b.pos + b.node.nodeSize, parentDepth: $a.depth }
}

/** Wrap the selected blocks in a new container of `type` with `options`. */
export function wrapBlocks(tr: Transaction, type: NodeType, options: Option[]): boolean {
  const range = selectedBlockRange(tr)
  if (!range) return false
  const slice = tr.doc.slice(range.from, range.to)
  const nodes: PMNode[] = []
  slice.content.forEach((n) => nodes.push(n))
  if (nodes.length === 0) return false
  const container = type.createAndFill({ blockOptions: options }, nodes)
  if (!container) return false
  tr.replaceWith(range.from, range.to, container)
  return true
}

/** The innermost ancestor of the selection of type `name`, with its position. */
export function ancestorOfType(tr: Transaction, name: string): { node: PMNode; pos: number } | null {
  const $from = tr.selection.$from
  for (let d = $from.depth; d >= 1; d--) {
    if ($from.node(d).type.name === name) return { node: $from.node(d), pos: $from.before(d) }
  }
  // A selected container itself.
  const sel = tr.selection as { node?: PMNode; from: number }
  if (sel.node?.type.name === name) return { node: sel.node, pos: sel.from }
  return null
}

/**
 * Replace the container at `pos` by its children (for columns: every column's
 * children). The blank lines that followed the container move to its last
 * child, so that block never runs into the next one in the file.
 */
export function unwrapAt(tr: Transaction, pos: number): boolean {
  const node = tr.doc.nodeAt(pos)
  if (!node) return false
  const children: PMNode[] = []
  node.forEach((child) => {
    if (child.type.name === 'column') child.forEach((c) => children.push(c))
    else children.push(child)
  })
  const $pos = tr.doc.resolve(pos)
  if (!BLOCK_PARENTS.has($pos.parent.type.name)) return false
  const trailing = node.attrs.blockTrailing as string | null | undefined
  tr.replaceWith(pos, pos + node.nodeSize, children)
  const last = children[children.length - 1]
  if (trailing && last && 'blockTrailing' in last.attrs && !last.attrs.blockTrailing) {
    const lastPos = pos + children.reduce((n, c) => n + c.nodeSize, 0) - last.nodeSize
    // A container's last block keeps its own line end in its source; the
    // container's trailing starts with the close line's, so drop that one.
    const origin = String(last.attrs.blockOrigin ?? '')
    const eol = /\r\n$/.exec(origin)?.[0] ?? /\n$/.exec(origin)?.[0] ?? ''
    const rest = eol && trailing.startsWith(eol) ? trailing.slice(eol.length) : trailing
    if (origin && rest && tr.doc.nodeAt(lastPos)?.type === last.type) tr.setNodeAttribute(lastPos, 'blockTrailing', rest)
  }
  return true
}

export function flag(key: string): Option {
  return makeOption(key, true)
}

/**
 * Insert a block node after the block at the selection, or in place of it
 * when that block is an empty paragraph. Shared by the block insert commands.
 */
export function insertBlockNode(tr: Transaction, node: PMNode): void {
  const leaf = blockChain(tr)[0]
  let at: number
  if (!leaf) {
    at = tr.doc.content.size
    tr.insert(at, node)
  } else if (leaf.node.type.name === 'paragraph' && leaf.node.content.size === 0) {
    at = leaf.pos
    tr.replaceWith(leaf.pos, leaf.pos + leaf.node.nodeSize, node)
  } else {
    at = leaf.pos + leaf.node.nodeSize
    tr.insert(at, node)
  }
  // The new block becomes the selection, so the next insert lands below it.
  if (node.isAtom) tr.setSelection(NodeSelection.create(tr.doc, at))
  else tr.setSelection(TextSelection.near(tr.doc.resolve(at + 1)))
}
