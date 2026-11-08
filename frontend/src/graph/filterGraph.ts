// Which nodes and edges a graph shows, from the compact `GET /api/graph` payload and the saved
// graph filters. Pure and synchronous, so toggling a filter is instant; every rule of
// the plan's "Graph semantics" lives here (and in `neighbourhood.ts` for the local scope).
//
// The graph build rules:
// - Each object draws its own links and its backlinks. With "Hide heavily linked objects", an
//   object with more than `LARGE_NODE_LIMIT` links + backlinks stays in the graph but draws none
//   of its own edges, and the local graph doesn't walk on from it.
// - A tag with `TAG_BACKLINK_LIMIT` or more backlinks doesn't draw its backlink edges.
// - Objects a type filter, an exclude or "Hide dates" removes become *reduced* nodes: they stay,
//   edges between two reduced nodes are dropped, and reduced nodes with one neighbour or none are
//   pruned, repeatedly. "Hide indirect links" removes every reduced node and its edges. There are
//   no synthesized node-to-node edges and no neighbour cap.
// - Completed tasks (unless "Show completed tasks") are left out entirely.
import type { GraphCustomization, GraphData } from '@/api/types'
import { neighbourhood } from './neighbourhood'

/** `hideLargeNodes`: more than this many links + backlinks. */
export const LARGE_NODE_LIMIT = 20
/** A tag with at least this many backlinks omits its backlink edges. */
export const TAG_BACKLINK_LIMIT = 10
/** The local graph's "Maximum distance": 1 to 5, one step at a time, 1 by default. */
export const MIN_HOPS = 1
export const MAX_HOPS = 5
export const DEFAULT_HOPS = 1

export type GraphScope = { kind: 'global' } | { kind: 'local'; center: number; hops: number }

export interface VisibleGraph {
  /** Shown node indexes, ascending (reduced nodes included). */
  nodes: number[]
  /** Links between shown nodes, `a < b`. */
  links: [number, number][]
  /** The shown nodes a filter reduced (drawn de-emphasised), ascending. */
  reduced: number[]
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
const statsCache = new WeakMap<GraphData, LinkStats>()

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

/** Direction of link pair `k` (1: a → b, 2: b → a, 3: both); both when the payload has none. */
export function linkDir(data: GraphData, k: number): number {
  return data.linkDirs?.[k] || 3
}

export interface LinkStats {
  /** A node's weight: its links plus its backlinks (a tag's tagged objects count as backlinks). */
  weight: Int32Array
  /** Distinct backlinks: objects linking to the node, and for a tag the objects carrying it. */
  backlinks: Int32Array
}

/** Per-node link counts of `data` (cached per payload). */
export function linkStats(data: GraphData): LinkStats {
  let stats = statsCache.get(data)
  if (stats) return stats
  const n = data.nodes.length
  const out = new Int32Array(n)
  const back = new Int32Array(n)
  const directed = !!data.linkDirs
  for (let k = 0; 2 * k + 1 < data.links.length; k++) {
    const a = data.links[2 * k]
    const b = data.links[2 * k + 1]
    if (a === b || a < 0 || b < 0 || a >= n || b >= n) continue
    if (!directed) {
      // Undirected payload: one link per end.
      out[a] += 1
      out[b] += 1
      continue
    }
    const d = linkDir(data, k)
    if (d & 1) {
      out[a] += 1
      back[b] += 1
    }
    if (d & 2) {
      out[b] += 1
      back[a] += 1
    }
  }
  // A tag's backlinks also hold the objects tagged with it; one that also links the tag counts once.
  const tags = taggedAdjacency(data)
  const adj = linkAdjacency(data)
  for (let t = 0; t < n; t++) {
    if (!data.nodes[t].tag || tags.offsets[t] === tags.offsets[t + 1]) continue
    const linked = new Set<number>()
    for (let k = adj.offsets[t]; k < adj.offsets[t + 1]; k++) linked.add(adj.targets[k])
    const carriers = new Set<number>()
    for (let k = tags.offsets[t]; k < tags.offsets[t + 1]; k++) {
      const o = tags.targets[k]
      if (!data.nodes[o].tag && !linked.has(o)) carriers.add(o)
    }
    back[t] += carriers.size
  }
  const weight = new Int32Array(n)
  for (let i = 0; i < n; i++) weight[i] = out[i] + back[i]
  stats = { weight, backlinks: back }
  statsCache.set(data, stats)
  return stats
}

/** True when "Hide heavily linked objects" keeps node `i` but skips its own edges. */
export function isLargeNode(data: GraphData, custom: GraphCustomization, i: number): boolean {
  return !!custom.hideLargeNodes && linkStats(data).weight[i] > LARGE_NODE_LIMIT
}

/** True when tag `i` omits its backlink edges (a tag with `TAG_BACKLINK_LIMIT` or more backlinks). */
export function omitsBacklinks(data: GraphData, i: number): boolean {
  return data.nodes[i].tag && linkStats(data).backlinks[i] >= TAG_BACKLINK_LIMIT
}

/** True when node `i` is left out entirely (a completed task without "Show completed tasks"). */
export function excludedEntirely(data: GraphData, custom: GraphCustomization, i: number): boolean {
  return !custom.showCompletedTasks && data.nodes[i].done
}

/** True when a filter reduces node `i` (type filter, exclude, "Hide dates"). */
export function reducedByFilters(data: GraphData, custom: GraphCustomization, i: number): boolean {
  const node = data.nodes[i]
  const filter = custom.filterTypeIds ?? []
  const exclude = custom.excludeTypeIds ?? []
  if (custom.hideDates && node.daily) return true
  if (exclude.includes(node.type)) return true
  if (filter.length > 0 && !filter.includes(node.type)) return true
  return false
}

const pairKey = (a: number, b: number, n: number) => (a < b ? a * n + b : b * n + a)

export function filterGraph(data: GraphData, custom: GraphCustomization, scope: GraphScope): VisibleGraph {
  const n = data.nodes.length
  const inScope = new Uint8Array(n)
  const shown = new Uint8Array(n)
  const reduced = new Uint8Array(n)
  const local = scope.kind === 'local' && scope.center >= 0 && scope.center < n
  const center = local ? scope.center : -1
  const localTags = local && data.nodes[center].tag && !!custom.showTagsNetwork
  const spaceTags = scope.kind === 'global' && !!custom.showSpaceTagsNetwork

  if (local) {
    for (const i of neighbourhood(data, center, scope.hops, localTags, custom)) inScope[i] = 1
  } else if (scope.kind === 'global') {
    inScope.fill(1)
  }
  for (let i = 0; i < n; i++) {
    if (!inScope[i]) continue
    if (i === center) {
      shown[i] = 1
      continue
    }
    if (excludedEntirely(data, custom, i)) continue
    shown[i] = 1
    // The global tags network shows every tag in full.
    if (reducedByFilters(data, custom, i) && !(spaceTags && data.nodes[i].tag)) reduced[i] = 1
  }

  // Large nodes skip their own edges; big tags (other than a local graph's centre) their backlinks.
  const skip = new Uint8Array(n)
  const omit = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    if (!shown[i]) continue
    if (isLargeNode(data, custom, i)) skip[i] = 1
    if (i !== center && omitsBacklinks(data, i)) omit[i] = 1
  }
  /** Whether the link `from → to` is drawn by either end. */
  const drawn = (from: number, to: number) => !skip[from] || (!skip[to] && !omit[to])

  const links: [number, number][] = []
  const direct = new Set<number>()
  for (let k = 0; 2 * k + 1 < data.links.length; k++) {
    const a = data.links[2 * k]
    const b = data.links[2 * k + 1]
    if (a === b || !shown[a] || !shown[b] || (reduced[a] && reduced[b])) continue
    const d = linkDir(data, k)
    if (!((d & 1 && drawn(a, b)) || (d & 2 && drawn(b, a)))) continue
    const key = pairKey(a, b, n)
    if (direct.has(key)) continue
    direct.add(key)
    links.push(a < b ? [a, b] : [b, a])
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
    // Object–tag pairs are the tag's backlinks: drawn only from the tag's side.
    const seen = new Set<number>()
    for (let k = 0; k + 1 < data.tagged.length; k += 2) {
      const o = data.tagged[k]
      const t = data.tagged[k + 1]
      if (o === t || !shown[o] || !shown[t] || (reduced[o] && reduced[t]) || skip[t] || omit[t]) continue
      const key = pairKey(o, t, n)
      if (seen.has(key) || direct.has(key)) continue
      seen.add(key)
      tagLinks.push(o < t ? [o, t] : [t, o])
    }
  }

  // "Hide indirect links" drops every reduced node; otherwise prune reduced nodes with at most
  // one neighbour until none is left.
  const gone = new Uint8Array(n)
  let anyReduced = false
  for (let i = 0; i < n; i++) if (reduced[i]) anyReduced = true
  if (anyReduced) {
    if (custom.hideIndirectLinks) {
      for (let i = 0; i < n; i++) if (reduced[i]) gone[i] = 1
    } else {
      const edges = links.length + tagLinks.length
      const flat = new Array<number>(edges * 2)
      let f = 0
      for (const [a, b] of links) {
        flat[f++] = a
        flat[f++] = b
      }
      for (const [a, b] of tagLinks) {
        flat[f++] = a
        flat[f++] = b
      }
      const adj = buildAdjacency(n, flat)
      const deg = new Int32Array(n)
      for (let i = 0; i < n; i++) deg[i] = adj.offsets[i + 1] - adj.offsets[i]
      const queue: number[] = []
      for (let i = 0; i < n; i++) if (shown[i] && reduced[i] && deg[i] <= 1) queue.push(i)
      while (queue.length > 0) {
        const r = queue.pop()!
        if (gone[r]) continue
        gone[r] = 1
        for (let k = adj.offsets[r]; k < adj.offsets[r + 1]; k++) {
          const v = adj.targets[k]
          if (gone[v]) continue
          deg[v] -= 1
          if (reduced[v] && deg[v] <= 1) queue.push(v)
        }
      }
    }
  }

  const nodes: number[] = []
  const reducedOut: number[] = []
  for (let i = 0; i < n; i++) {
    if (!shown[i] || gone[i]) continue
    nodes.push(i)
    if (reduced[i]) reducedOut.push(i)
  }
  const keep = ([a, b]: [number, number]) => !gone[a] && !gone[b]
  return {
    nodes,
    links: anyReduced ? links.filter(keep) : links,
    reduced: reducedOut,
    tagLinks: anyReduced ? tagLinks.filter(keep) : tagLinks,
  }
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
