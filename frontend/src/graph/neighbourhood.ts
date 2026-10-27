// The local graph's neighbourhood: breadth-first over link edges from the centre, 1 or 2 hops,
// plus the `tagged` pairs when the centre is a Tag and "Show tags network" is on.
import type { GraphData } from '@/api/types'
import { linkAdjacency, taggedAdjacency } from './filterGraph'

export function neighbourhood(data: GraphData, center: number, hops: number, includeTagged: boolean): Set<number> {
  const out = new Set<number>()
  if (center < 0 || center >= data.nodes.length) return out
  const links = linkAdjacency(data)
  const tagged = includeTagged ? taggedAdjacency(data) : null
  out.add(center)
  let frontier = [center]
  for (let d = 0; d < hops && frontier.length > 0; d++) {
    const next: number[] = []
    for (const u of frontier) {
      for (const adj of tagged ? [links, tagged] : [links]) {
        for (let k = adj.offsets[u]; k < adj.offsets[u + 1]; k++) {
          const v = adj.targets[k]
          if (out.has(v)) continue
          out.add(v)
          next.push(v)
        }
      }
    }
    frontier = next
  }
  return out
}
