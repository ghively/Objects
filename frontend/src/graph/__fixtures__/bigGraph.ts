// A deterministic 5,000-node / 50,000-link graph payload for the filterGraph budget test.
import type { GraphData, GraphNode } from '@/api/types'

/** Park–Miller LCG, so every run builds the same graph. */
function rng(seed: number): () => number {
  let s = seed % 2147483647
  if (s <= 0) s += 2147483646
  return () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
}

const TYPES = ['page', 'person', 'project', 'task', 'dailynote', 'tag']

export function bigGraph(nodes = 5000, links = 50000, seed = 7): GraphData {
  const rand = rng(seed)
  const out: GraphNode[] = []
  for (let i = 0; i < nodes; i++) {
    const type = TYPES[i % TYPES.length]
    out.push({
      path: `${type}/Object ${i}.md`,
      title: `Object ${i}`,
      type,
      icon: null,
      degree: 0,
      tag: type === 'tag',
      daily: type === 'dailynote',
      done: type === 'task' && i % 4 === 0,
    })
  }
  const seen = new Set<number>()
  const flat: number[] = []
  while (flat.length < links * 2) {
    // A skewed pick, so a few hubs exceed the large-node limit.
    const a = Math.floor(Math.pow(rand(), 2) * nodes)
    const b = Math.floor(rand() * nodes)
    if (a === b) continue
    const lo = Math.min(a, b)
    const hi = Math.max(a, b)
    const key = lo * nodes + hi
    if (seen.has(key)) continue
    seen.add(key)
    flat.push(lo, hi)
    out[lo].degree += 1
    out[hi].degree += 1
  }
  const tagged: number[] = []
  const tags = out.map((n, i) => (n.tag ? i : -1)).filter((i) => i >= 0)
  for (let i = 0; i < nodes; i++) {
    if (out[i].tag || i % 3 !== 0) continue
    tagged.push(i, tags[Math.floor(rand() * tags.length)])
    tagged.push(i, tags[Math.floor(rand() * tags.length)])
  }
  return { nodes: out, links: flat, tagged }
}
