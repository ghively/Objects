// M13: nesting rows under their parent item (the table and timeline layouts, with the view's
// `subItemsConfig`). Pure: every row of the input appears exactly once in the output.
//
// A row is drawn under its parent when the parent (the first resolved link of the "Parent item"
// property) is also among the rows; otherwise it is a top-level row. Rows on a cycle of parents
// are all top-level (a row hanging off a cycle nests under its cycle member). Siblings, and the
// top-level rows, keep the input's order, so the view's sort applies among siblings.
import type { Row } from '@/api/types'

export interface RowTree {
  /** Top-level rows, in input order. */
  roots: Row[]
  /** Path -> its child rows, in input order (only parents that have some). */
  children: Map<string, Row[]>
}

/** The parent path a row names through `parentKey` (its first resolved link), or null. */
export function parentPath(row: Row, parentKey: string): string | null {
  const links = row.links?.[parentKey]
  if (!Array.isArray(links)) return null
  for (const p of links) if (p) return p
  return null
}

export function buildRowTree(rows: Row[], parentKey: string): RowTree {
  const index = new Map<string, Row>()
  for (const r of rows) if (!index.has(r.summary.path)) index.set(r.summary.path, r)
  // The in-view parent of each row (never itself).
  const parentOf = new Map<string, string>()
  for (const r of index.values()) {
    const p = parentPath(r, parentKey)
    if (p && p !== r.summary.path && index.has(p)) parentOf.set(r.summary.path, p)
  }
  // Find the rows on a cycle of parents: walk each chain once (0 unseen, 1 on the current walk, 2 done).
  const state = new Map<string, 1 | 2>()
  const onCycle = new Set<string>()
  for (const start of index.keys()) {
    if (state.has(start)) continue
    const walk: string[] = []
    let at: string | undefined = start
    while (at !== undefined && !state.has(at)) {
      state.set(at, 1)
      walk.push(at)
      at = parentOf.get(at)
    }
    if (at !== undefined && state.get(at) === 1) {
      // The chain came back to a row of this walk: from there on, it is a cycle.
      for (let i = walk.indexOf(at); i < walk.length; i++) onCycle.add(walk[i])
    }
    for (const p of walk) state.set(p, 2)
  }
  const roots: Row[] = []
  const children = new Map<string, Row[]>()
  const seen = new Set<string>()
  for (const r of rows) {
    const path = r.summary.path
    if (seen.has(path)) continue
    seen.add(path)
    const parent = onCycle.has(path) ? undefined : parentOf.get(path)
    if (parent === undefined) roots.push(r)
    else {
      const list = children.get(parent)
      if (list) list.push(r)
      else children.set(parent, [r])
    }
  }
  return { roots, children }
}

export interface TreeRow {
  row: Row
  depth: number
  /** Whether the row has child rows (it shows a toggle). */
  hasChildren: boolean
}

/** The tree in display order (depth first); every row once. */
export function flattenTree(tree: RowTree): TreeRow[] {
  const out: TreeRow[] = []
  const visit = (row: Row, depth: number) => {
    const kids = tree.children.get(row.summary.path)
    out.push({ row, depth, hasChildren: !!kids?.length })
    if (kids) for (const k of kids) visit(k, depth + 1)
  }
  for (const r of tree.roots) visit(r, 0)
  return out
}

/** `flattenTree` without the rows under a closed parent (`closed` holds paths). */
export function visibleTreeRows(rows: TreeRow[], closed: ReadonlySet<string>): TreeRow[] {
  if (closed.size === 0) return rows
  const out: TreeRow[] = []
  let hideBelow = -1
  for (const r of rows) {
    if (hideBelow >= 0) {
      if (r.depth > hideBelow) continue
      hideBelow = -1
    }
    out.push(r)
    if (r.hasChildren && closed.has(r.row.summary.path)) hideBelow = r.depth
  }
  return out
}
