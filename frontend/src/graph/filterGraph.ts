// Which nodes and edges a graph shows, from the compact `GET /api/graph` payload and the saved
// `GraphViewCustomization`. Pure and synchronous, so toggling a filter is instant; every rule of
// the plan's "Graph semantics" lives here (and in `neighbourhood.ts` for the local scope).
import type { GraphCustomization, GraphData } from '@/api/types'
import { neighbourhood } from './neighbourhood'

/** `hideLargeNodes` hides nodes with more than this many links (our value; Capacities' `{limit}` is not in the reference). */
export const LARGE_NODE_LIMIT = 100
/** A hidden node adds indirect edges only when it has at most this many shown neighbours (our cap). */
export const INDIRECT_MAX_NEIGHBOURS = 10
/** At most this many indirect edges in one graph. */
export const INDIRECT_MAX_EDGES = 50000

export type GraphScope = { kind: 'global' } | { kind: 'local'; center: number; hops: 1 | 2 }

export interface VisibleGraph {
  /** Shown node indexes, ascending. */
  nodes: number[]
  /** Direct links between shown nodes, `a < b`. */
  links: [number, number][]
  /** Links that pass through one hidden node (drawn fainter), `a < b`. */
  indirect: [number, number][]
  /** Tag edges: co-tag pairs on the global tags network; object–tag pairs on a tag's local graph. */
  tagLinks: [number, number][]
}

export interface Adjacency {
  /** CSR offsets: the neighbours of `i` are `targets[offsets[i] .. offsets[i + 1])`. */
  offsets: Int32Array
  targets: Int32Array
}

function buildAdjacency(n: number, flat: number[]): Adjacency {
  const counts = new Int32Array(n + 1)
  for (let k = 0; k + 1 < flat.length; k += 2) {
    const a = flat[k]
    const b = flat[k + 1]
    if (a === b || a < 0 || b < 0 || a >= n || b >= n) continue
    counts[a + 1] += 1
    counts[b + 1] += 1
  }
  for (let i = 0; i < n; i++) counts[i + 1] += counts[i]
  const offsets = counts
  const fill = offsets.slice(0, n)
  const targets = new Int32Array(offsets[n])
  for (let k = 0; k + 1 < flat.length; k += 2) {
    const a = flat[k]
    const b = flat[k + 1]
    if (a === b || a < 0 || b < 0 || a >= n || b >= n) continue
    targets[fill[a]++] = b
    targets[fill[b]++] = a
  }
  return { offsets, targets }
}

const linkCache = new WeakMap<GraphData, Adjacency>()
const taggedCache = new WeakMap<GraphData, Adjacency>()

/** Link adjacency of `data` (cached per payload). */
export function linkAdjacency(data: GraphData): Adjacency {
  let adj = linkCache.get(data)
  if (!adj) {
    adj = buildAdjacency(data.nodes.length, data.links)
    linkCache.set(data, adj)
  }
  return adj
}

/** `tagged` adjacency of `data` (object ↔ tag; cached per payload). */
export function taggedAdjacency(data: GraphData): Adjacency {
  let adj = taggedCache.get(data)
  if (!adj) {
    adj = buildAdjacency(data.nodes.length, data.tagged)
    taggedCache.set(data, adj)
  }
  return adj
}

/** True when a filter hides node `i` (before the scope, the tags network and the centre rule). */
export function hiddenByFilters(data: GraphData, custom: GraphCustomization, i: number): boolean {
  const node = data.nodes[i]
  const filter = custom.filterStructureIds ?? []
  const exclude = custom.excludeStructureIds ?? []
  if (exclude.includes(node.type)) return true
  if (filter.length > 0 && !filter.includes(node.type)) return true
  if (!custom.showCompletedTasks && node.done) return true
  if (custom.hideDates && node.daily) return true
  if (custom.hideLargeNodes && node.degree > LARGE_NODE_LIMIT) return true
  return false
}

const pairKey = (a: number, b: number, n: number) => (a < b ? a * n + b : b * n + a)

export function filterGraph(data: GraphData, custom: GraphCustomization, scope: GraphScope): VisibleGraph {
  const n = data.nodes.length
  const adj = linkAdjacency(data)
  const inScope = new Uint8Array(n)
  const shown = new Uint8Array(n)
  const local = scope.kind === 'local' && scope.center >= 0 && scope.center < n
  const localTags = local && data.nodes[scope.center].tag && !!custom.showTagsNetwork
  const spaceTags = scope.kind === 'global' && !!custom.showSpaceTagsNetwork

  if (local) {
    for (const i of neighbourhood(data, scope.center, scope.hops, localTags)) inScope[i] = 1
  } else if (scope.kind === 'global') {
    inScope.fill(1)
  }
  for (let i = 0; i < n; i++) {
    if (!inScope[i]) continue
    if (!hiddenByFilters(data, custom, i)) shown[i] = 1
    // The global tags network shows every tag.
    else if (spaceTags && data.nodes[i].tag) shown[i] = 1
  }
  if (local) shown[scope.center] = 1

  const nodes: number[] = []
  for (let i = 0; i < n; i++) if (shown[i]) nodes.push(i)

  const links: [number, number][] = []
  const direct = new Set<number>()
  for (let k = 0; k + 1 < data.links.length; k += 2) {
    const a = data.links[k]
    const b = data.links[k + 1]
    if (a === b || !shown[a] || !shown[b]) continue
    const key = pairKey(a, b, n)
    if (direct.has(key)) continue
    direct.add(key)
    links.push(a < b ? [a, b] : [b, a])
  }

  const indirect: [number, number][] = []
  if (!custom.hideIndirectLinks) {
    const seen = new Set<number>()
    const around: number[] = []
    outer: for (let h = 0; h < n; h++) {
      if (!inScope[h] || shown[h]) continue
      around.length = 0
      let over = false
      for (let k = adj.offsets[h]; k < adj.offsets[h + 1]; k++) {
        const v = adj.targets[k]
        if (!shown[v] || around.includes(v)) continue
        around.push(v)
        if (around.length > INDIRECT_MAX_NEIGHBOURS) {
          over = true
          break
        }
      }
      if (over || around.length < 2) continue
      for (let x = 0; x < around.length; x++) {
        for (let y = x + 1; y < around.length; y++) {
          const key = pairKey(around[x], around[y], n)
          if (direct.has(key) || seen.has(key)) continue
          seen.add(key)
          const a = around[x]
          const b = around[y]
          indirect.push(a < b ? [a, b] : [b, a])
          if (indirect.length >= INDIRECT_MAX_EDGES) break outer
        }
      }
    }
  }

  const tagLinks: [number, number][] = []
  if (spaceTags) {
    // Two tags are linked whenever one object carries both.
    const tags = taggedAdjacency(data)
    const seen = new Set<number>()
    for (let o = 0; o < n; o++) {
      if (data.nodes[o].tag) continue
      const from = tags.offsets[o]
      const to = tags.offsets[o + 1]
      for (let x = from; x < to; x++) {
        for (let y = x + 1; y < to; y++) {
          const a = tags.targets[x]
          const b = tags.targets[y]
          if (a === b || !shown[a] || !shown[b]) continue
          const key = pairKey(a, b, n)
          if (seen.has(key) || direct.has(key)) continue
          seen.add(key)
          tagLinks.push(a < b ? [a, b] : [b, a])
        }
      }
    }
  } else if (localTags) {
    const seen = new Set<number>()
    for (let k = 0; k + 1 < data.tagged.length; k += 2) {
      const a = data.tagged[k]
      const b = data.tagged[k + 1]
      if (a === b || !shown[a] || !shown[b]) continue
      const key = pairKey(a, b, n)
      if (seen.has(key) || direct.has(key)) continue
      seen.add(key)
      tagLinks.push(a < b ? [a, b] : [b, a])
    }
  }

  return { nodes, links, indirect, tagLinks }
}

// ---- search in the graph -------------------------------------------------------------------

/** Score `title` against `query` like the palette's title matcher (0 = no match). */
export function titleScore(query: string, title: string): number {
  const q = query.trim().toLowerCase()
  const t = title.toLowerCase()
  if (!q) return 0
  if (t === q) return 1000
  if (t.startsWith(q)) return 800
  const words = t.split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  const qWords = q.split(/\s+/).filter(Boolean)
  if (qWords.every((w) => words.some((x) => x.startsWith(w)))) return 600
  if (t.includes(q)) return 400
  // In-order subsequence, 100–300 by contiguity.
  let pos = 0
  let runs = 0
  let last = -2
  for (const ch of q.replace(/\s+/g, '')) {
    const at = t.indexOf(ch, pos)
    if (at < 0) return 0
    if (at !== last + 1) runs += 1
    last = at
    pos = at + 1
  }
  const len = q.replace(/\s+/g, '').length
  return Math.round(100 + 200 * (len <= 1 ? 1 : (len - runs) / (len - 1)))
}

/** The visible node whose title best matches `query` (ties: shorter title, then lower index). */
export function bestMatch(data: GraphData, visible: number[], query: string): number | null {
  let best: number | null = null
  let bestScore = 0
  for (const i of visible) {
    const title = data.nodes[i].title
    const s = titleScore(query, title)
    if (s === 0) continue
    if (
      s > bestScore ||
      (s === bestScore && best !== null && title.length < data.nodes[best].title.length)
    ) {
      best = i
      bestScore = s
    }
  }
  return best
}
