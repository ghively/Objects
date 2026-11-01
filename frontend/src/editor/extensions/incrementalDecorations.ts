/**
 * Decoration sets rebuilt only where the document changed.
 *
 * A plugin describes its decorations as a `DecorationVisitor`: called for a
 * node and its position as `doc.descendants` would, it pushes the node's
 * decorations and returns whether to look inside it. `buildDecorations` runs
 * the visitor over the whole document (a load); `updateDecorations` maps the
 * old set through a transaction and runs it again only over the top-level
 * blocks the transaction touched. Before this every one of these plugins
 * walked the whole document on every keystroke (audit 2026-11-01 F8: ~225 ms
 * on a 1 MB body).
 *
 * The decorations of a top-level block must depend on that block alone (they
 * do: a table's formulas, a toggle's children, a block's own options...), and
 * none may sit exactly on a block's outer boundary, since a rebuild removes
 * every decoration within the block's range, boundaries included.
 */
import type { Node as PMNode } from '@tiptap/pm/model'
import type { Transaction } from '@tiptap/pm/state'
import type { Decoration } from '@tiptap/pm/view'
import { DecorationSet } from '@tiptap/pm/view'

export type DecorationVisitor = (node: PMNode, pos: number, decos: Decoration[]) => boolean

function collect(node: PMNode, pos: number, visit: DecorationVisitor, decos: Decoration[]): void {
  if (visit(node, pos, decos)) node.descendants((child, offset) => visit(child, pos + 1 + offset, decos))
}

/** The decorations of the whole document. */
export function buildDecorations(doc: PMNode, visit: DecorationVisitor): DecorationSet {
  const decos: Decoration[] = []
  doc.forEach((child, offset) => collect(child, offset, visit, decos))
  return DecorationSet.create(doc, decos)
}

/**
 * The ranges of `tr.doc` its steps changed. A step that changes an attribute
 * or a mark has no replaced range and counts as its position (or span); an
 * unknown step counts as the whole document.
 */
export function changedRanges(tr: Transaction): [number, number][] {
  const ranges: [number, number][] = []
  tr.steps.forEach((step, i) => {
    const rest = tr.mapping.slice(i + 1)
    let any = false
    step.getMap().forEach((_oldStart, _oldEnd, newStart, newEnd) => {
      any = true
      ranges.push([rest.map(newStart, -1), rest.map(newEnd, 1)])
    })
    if (any) return
    const s = step as unknown as { pos?: number; from?: number; to?: number }
    const size = tr.docs[i + 1]?.content.size ?? tr.doc.content.size
    const [from, to] =
      typeof s.pos === 'number' ? [s.pos, Math.min(s.pos + 1, size)] : typeof s.from === 'number' && typeof s.to === 'number' ? [s.from, s.to] : [0, size]
    ranges.push([rest.map(from, -1), rest.map(to, 1)])
  })
  return ranges
}

/**
 * `old` after `tr`: mapped, with the top-level blocks the transaction changed
 * (and those holding the `also` positions, given in `tr.doc`) rebuilt. A
 * deletion on the boundary between two blocks rebuilds both.
 */
export function updateDecorations(old: DecorationSet, tr: Transaction, visit: DecorationVisitor, also: number[] = []): DecorationSet {
  if (!tr.docChanged && also.length === 0) return old
  const doc = tr.doc
  let set = tr.docChanged ? old.map(tr.mapping, doc) : old
  const ranges = tr.docChanged ? changedRanges(tr) : []
  for (const p of also) {
    const at = Math.max(0, Math.min(p, doc.content.size))
    ranges.push([at, at])
  }
  if (ranges.length === 0) return set
  doc.forEach((child, offset) => {
    const end = offset + child.nodeSize
    // A range overlapping the block, or an empty one on it (a deleted block: both neighbours).
    if (!ranges.some(([from, to]) => (from < end && to > offset) || (from === to && from >= offset && from <= end))) return
    const stale = set.find(offset, end).filter((d) => d.from >= offset && d.to <= end)
    if (stale.length) set = set.remove(stale)
    const decos: Decoration[] = []
    collect(child, offset, visit, decos)
    if (decos.length) set = set.add(doc, decos)
  })
  return set
}
