// The local graph's neighbourhood: breadth-first over link edges from the centre, `hops` steps
// (1–5), plus the `tagged` pairs when the centre is a Tag and "Show tags network" is on.
// Object's local walk (reference-check-2026-10-28.md §3b): completed tasks are not walked
// unless shown; with "Hide objects with many links" the walk doesn't go on from a large node (the
// centre included); a tag other than the centre with 10 or more backlinks isn't walked through
// its backlinks.
import type { GraphCustomization, GraphData } from '@/api/types'
import { excludedEntirely, isLargeNode, linkAdjacency, linkDir, omitsBacklinks, taggedAdjacency, type Adjacency } from './filterGraph'

const outCache = new WeakMap<GraphData, Adjacency>()

/** Directed adjacency: the objects each node links to (cached per payload). */
function outAdjacency(data: GraphData): Adjacency {
  let adj = outCache.get(data)
  if (adj) return adj
  const n = data.nodes.length
  const counts = new Int32Array(n + 1)
  const each = (fn: (from: number, to: number) => void) => {
    for (let k = 0; 2 * k + 1 < data.links.length; k++) {
      const a = data.links[2 * k]
      const b = data.links[2 * k + 1]
      if (a === b || a < 0 || b < 0 || a >= n || b >= n) continue
      const d = linkDir(data, k)
      if (d & 1) fn(a, b)
      if (d & 2) fn(b, a)
    }
  }
  each((from) => (counts[from + 1] += 1))
  for (let i = 0; i < n; i++) counts[i + 1] += counts[i]
  const fill = counts.slice(0, n)
  const targets = new Int32Array(counts[n])
  each((from, to) => (targets[fill[from]++] = to))
  adj = { offsets: counts, targets }
  outCache.set(data, adj)
  return adj
}

export function neighbourhood(
  data: GraphData,
  center: number,
  hops: number,
  includeTagged: boolean,
  custom: GraphCustomization = { showCompletedTasks: true },
): Set<number> {
  const out = new Set<number>()
  if (center < 0 || center >= data.nodes.length) return out
  const links = linkAdjacency(data)
  const tagged = includeTagged ? taggedAdjacency(data) : null
  out.add(center)
  let frontier = [center]
  for (let d = 0; d < hops && frontier.length > 0; d++) {
    const next: number[] = []
    for (const u of frontier) {
      if (isLargeNode(data, custom, u)) continue
      // A big tag (not the centre) is left only through its own links, not its backlinks.
      const ownLinksOnly = u !== center && omitsBacklinks(data, u)
      const lists: Adjacency[] = ownLinksOnly ? [outAdjacency(data)] : tagged ? [links, tagged] : [links]
      for (const adj of lists) {
        for (let k = adj.offsets[u]; k < adj.offsets[u + 1]; k++) {
          const v = adj.targets[k]
          if (out.has(v) || excludedEntirely(data, custom, v)) continue
          out.add(v)
          next.push(v)
        }
      }
    }
    frontier = next
  }
  return out
}
