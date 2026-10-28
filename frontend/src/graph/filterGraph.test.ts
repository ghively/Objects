import { describe, expect, test } from 'vitest'
import type { GraphData, GraphNode } from '@/api/types'
import { bigGraph } from './__fixtures__/bigGraph'
import { LARGE_NODE_LIMIT, TAG_BACKLINK_LIMIT, bestMatch, filterGraph, linkStats, titleScore } from './filterGraph'

function node(path: string, partial: Partial<GraphNode> = {}): GraphNode {
  return { path, title: path, type: 'page', icon: null, degree: 0, tag: false, daily: false, done: false, ...partial }
}

/** `links` are directed `[from, to]`; the payload gets each pair once with its direction. */
function graph(nodes: GraphNode[], links: [number, number][], tagged: [number, number][] = []): GraphData {
  const dirs = new Map<string, number>()
  for (const [from, to] of links) {
    const key = from < to ? `${from},${to}` : `${to},${from}`
    dirs.set(key, (dirs.get(key) ?? 0) | (from < to ? 1 : 2))
  }
  const deg = nodes.map(() => 0)
  const flat: number[] = []
  const linkDirs: number[] = []
  for (const [key, d] of dirs) {
    const [a, b] = key.split(',').map(Number)
    flat.push(a, b)
    linkDirs.push(d)
    deg[a] += 1
    deg[b] += 1
  }
  return {
    nodes: nodes.map((n, i) => ({ ...n, degree: n.degree || deg[i] })),
    links: flat,
    linkDirs,
    tagged: tagged.flat(),
  }
}

const G = { kind: 'global' } as const

/** A hub linked from `k` leaves, each leaf linking it (`hub` is node 0). */
function star(k: number, hub: Partial<GraphNode> = {}) {
  const nodes = [node('hub', hub), ...Array.from({ length: k }, (_, i) => node(`n${i}`))]
  return graph(nodes, Array.from({ length: k }, (_, i) => [i + 1, 0] as [number, number]))
}

describe('filterGraph', () => {
  test('type filter and exclude reduce nodes instead of removing them; exclude wins', () => {
    // a — b — c: b, when filtered out, stays as a reduced node carrying a's and c's links.
    const data = graph(
      [node('a', { type: 'page' }), node('b', { type: 'person' }), node('c', { type: 'project' })],
      [[0, 1], [1, 2]],
    )
    expect(filterGraph(data, {}, G)).toEqual({ nodes: [0, 1, 2], links: [[0, 1], [1, 2]], reduced: [], tagLinks: [] })
    const ex = filterGraph(data, { excludeStructureIds: ['person'] }, G)
    expect(ex.nodes).toEqual([0, 1, 2])
    expect(ex.reduced).toEqual([1])
    expect(ex.links).toEqual([[0, 1], [1, 2]])
    // c is filtered out and has one neighbour: pruned.
    const filtered = filterGraph(data, { filterStructureIds: ['page', 'person'] }, G)
    expect(filtered.nodes).toEqual([0, 1])
    expect(filtered.reduced).toEqual([])
    expect(filtered.links).toEqual([[0, 1]])
    // Listed in both: still excluded (reduced, then pruned with only a left as its neighbour).
    const both = filterGraph(data, { filterStructureIds: ['page', 'person'], excludeStructureIds: ['person'] }, G)
    expect(both.nodes).toEqual([0])
    expect(both.links).toEqual([])
  })

  test('edges between two reduced nodes are dropped, and pruning repeats', () => {
    // a — x — y — b with x, y hidden: the x–y edge goes, so x and y each keep one neighbour: pruned.
    const chain = graph([node('a'), node('x', { type: 'hidden' }), node('y', { type: 'hidden' }), node('b')], [[0, 1], [1, 2], [2, 3]])
    const v = filterGraph(chain, { excludeStructureIds: ['hidden'] }, G)
    expect(v.nodes).toEqual([0, 3])
    expect(v.links).toEqual([])
    // A reduced node between two shown ones stays; a dangling reduced leaf of it is pruned first.
    const tree = graph([node('a'), node('x', { type: 'hidden' }), node('b'), node('leaf', { type: 'hidden' })], [[0, 1], [1, 2], [1, 3]])
    expect(filterGraph(tree, { excludeStructureIds: ['hidden'] }, G)).toEqual({
      nodes: [0, 1, 2],
      links: [[0, 1], [1, 2]],
      reduced: [1],
      tagLinks: [],
    })
  })

  test('hide indirect links removes every reduced node and its edges; no synthesized edges or neighbour cap', () => {
    const small = graph([node('a'), node('x', { type: 'hidden' }), node('b')], [[0, 1], [1, 2]])
    const off = filterGraph(small, { excludeStructureIds: ['hidden'], hideIndirectLinks: true }, G)
    expect(off).toEqual({ nodes: [0, 2], links: [], reduced: [], tagLinks: [] })
    // A reduced hub with many shown neighbours stays, and only real edges are drawn.
    const k = 30
    const hub = star(k, { type: 'hidden' })
    const v = filterGraph(hub, { excludeStructureIds: ['hidden'] }, G)
    expect(v.reduced).toEqual([0])
    expect(v.nodes).toHaveLength(k + 1)
    expect(v.links).toHaveLength(k)
    expect(v.links.every(([a]) => a === 0)).toBe(true)
  })

  test('completed tasks are left out entirely, not reduced', () => {
    const data = graph([node('t1', { type: 'task', done: true }), node('t2', { type: 'task' })], [[0, 1]])
    expect(filterGraph(data, {}, G).nodes).toEqual([1])
    expect(filterGraph(data, {}, G).reduced).toEqual([])
    expect(filterGraph(data, { showCompletedTasks: true }, G).nodes).toEqual([0, 1])
  })

  test('hide dates reduces daily notes', () => {
    const data = graph([node('a'), node('d', { daily: true }), node('b')], [[0, 1], [2, 1]])
    const v = filterGraph(data, { hideDates: true }, G)
    expect(v.nodes).toEqual([0, 1, 2])
    expect(v.reduced).toEqual([1])
    expect(filterGraph(data, { hideDates: true, hideIndirectLinks: true }, G).nodes).toEqual([0, 2])
  })

  test('large nodes (more than 20 links + backlinks) stay but draw none of their own edges', () => {
    expect(LARGE_NODE_LIMIT).toBe(20)
    // Leaves link the hub: each leaf draws its own link, so the edges stay.
    const inbound = star(LARGE_NODE_LIMIT + 1)
    expect(linkStats(inbound).weight[0]).toBe(LARGE_NODE_LIMIT + 1)
    const v = filterGraph(inbound, { hideLargeNodes: true }, G)
    expect(v.nodes).toHaveLength(LARGE_NODE_LIMIT + 2)
    expect(v.links).toHaveLength(LARGE_NODE_LIMIT + 1)

    // The hub links the leaves: the leaves still draw them as their backlinks.
    const nodes = [node('hub'), ...Array.from({ length: LARGE_NODE_LIMIT + 1 }, (_, i) => node(`n${i}`))]
    const outbound = graph(nodes, Array.from({ length: LARGE_NODE_LIMIT + 1 }, (_, i) => [0, i + 1] as [number, number]))
    expect(filterGraph(outbound, { hideLargeNodes: true }, G).links).toHaveLength(LARGE_NODE_LIMIT + 1)

    // Two hubs linking each other, each also linking `leaves` objects of its own.
    const twoHubs = (leaves: number) => {
      const links: [number, number][] = [[0, 1]]
      for (let i = 0; i < leaves; i++) {
        links.push([0, 2 + i])
        links.push([1, 2 + leaves + i])
      }
      return graph([node('h0'), node('h1'), ...Array.from({ length: 2 * leaves }, (_, i) => node(`m${i}`))], links)
    }
    // Both large: neither draws the hub–hub edge; their other edges stay (drawn by the leaves).
    const hubs = twoHubs(LARGE_NODE_LIMIT)
    expect(linkStats(hubs).weight[0]).toBe(LARGE_NODE_LIMIT + 1)
    const pair = filterGraph(hubs, { hideLargeNodes: true }, G)
    expect(pair.nodes).toHaveLength(hubs.nodes.length)
    expect(pair.links).toHaveLength(2 * LARGE_NODE_LIMIT)
    expect(pair.links).not.toContainEqual([0, 1])
    expect(filterGraph(hubs, {}, G).links).toContainEqual([0, 1])
    // At the limit (20 links + backlinks): not large, so the hub–hub edge is drawn.
    const atLimit = twoHubs(LARGE_NODE_LIMIT - 1)
    expect(linkStats(atLimit).weight[0]).toBe(LARGE_NODE_LIMIT)
    expect(filterGraph(atLimit, { hideLargeNodes: true }, G).links).toContainEqual([0, 1])
  })

  test('a tag with 10 or more backlinks omits its backlink edges', () => {
    expect(TAG_BACKLINK_LIMIT).toBe(10)
    // Objects carrying the tag are its backlinks; on its local graph (tags network) they are object–tag edges.
    const carriers = (k: number) => {
      const nodes = [node('t', { type: 'tag', tag: true }), ...Array.from({ length: k }, (_, i) => node(`o${i}`))]
      return graph(nodes, [], Array.from({ length: k }, (_, i) => [i + 1, 0] as [number, number]))
    }
    const below = carriers(TAG_BACKLINK_LIMIT - 1)
    expect(linkStats(below).backlinks[0]).toBe(TAG_BACKLINK_LIMIT - 1)
    // The centre tag itself still draws them (Capacities walks the centre's backlinks).
    const local = (data: GraphData) => filterGraph(data, { showTagsNetwork: true }, { kind: 'local', center: 0, hops: 1 })
    expect(local(below).tagLinks).toHaveLength(TAG_BACKLINK_LIMIT - 1)
    expect(local(carriers(TAG_BACKLINK_LIMIT)).tagLinks).toHaveLength(TAG_BACKLINK_LIMIT)

    // A big tag that isn't the centre: a large object's link to it isn't drawn by either end.
    const nodes = [node('hub'), node('t', { type: 'tag', tag: true }), ...Array.from({ length: 30 }, (_, i) => node(`o${i}`))]
    const links: [number, number][] = [[0, 1]]
    for (let i = 0; i < LARGE_NODE_LIMIT; i++) links.push([0, 2 + i])
    for (let i = 0; i < TAG_BACKLINK_LIMIT; i++) links.push([2 + LARGE_NODE_LIMIT + i - 10, 1])
    const data = graph(nodes, links)
    expect(linkStats(data).backlinks[1]).toBeGreaterThanOrEqual(TAG_BACKLINK_LIMIT)
    const v = filterGraph(data, { hideLargeNodes: true }, G)
    expect(v.links.some(([a, b]) => a === 0 && b === 1)).toBe(false)
  })

  test('space tags network shows every tag and co-tag edges', () => {
    const data = graph(
      [node('o1'), node('o2'), node('t1', { type: 'tag', tag: true }), node('t2', { type: 'tag', tag: true }), node('t3', { type: 'tag', tag: true })],
      [],
      [[0, 2], [0, 3], [1, 3], [1, 4]],
    )
    expect(filterGraph(data, {}, G).tagLinks).toEqual([])
    const v = filterGraph(data, { showSpaceTagsNetwork: true, filterStructureIds: ['page'] }, G)
    expect(v.nodes).toEqual([0, 1, 2, 3, 4])
    expect(v.reduced).toEqual([])
    expect(v.tagLinks).toEqual([[2, 3], [3, 4]])
  })

  test('filterGraph 5000 nodes 50000 links under 100ms', () => {
    const data = bigGraph()
    expect(data.nodes).toHaveLength(5000)
    expect(data.links).toHaveLength(100000)
    const slack = Number(process.env.OBJECT_PERF_SLACK ?? '1') || 1
    filterGraph(data, {}, G) // warm the adjacency cache and the JIT
    const custom = { excludeStructureIds: ['person'], hideLargeNodes: true }
    const t0 = performance.now()
    const v = filterGraph(data, custom, G)
    const ms = performance.now() - t0
    expect(v.nodes.length).toBeGreaterThan(0)
    expect(v.reduced.length).toBeGreaterThan(0)
    expect(ms).toBeLessThan(100 * slack)
  })
})

describe('search in the graph', () => {
  test('scores exact, prefix, word prefix, substring and subsequence in order', () => {
    expect(titleScore('ada', 'Ada')).toBe(1000)
    expect(titleScore('ada', 'Ada Lovelace')).toBe(800)
    expect(titleScore('love', 'Ada Lovelace')).toBe(600)
    expect(titleScore('vela', 'Ada Lovelace')).toBe(400)
    const sub = titleScore('alvl', 'Ada Lovelace')
    expect(sub).toBeGreaterThanOrEqual(100)
    expect(sub).toBeLessThanOrEqual(300)
    expect(titleScore('xyz', 'Ada Lovelace')).toBe(0)
  })

  test('best match among visible nodes only', () => {
    const data = graph([node('Ada Lovelace'), node('Ada'), node('Charles Babbage')], [])
    expect(bestMatch(data, [0, 1, 2], 'ada')).toBe(1)
    expect(bestMatch(data, [0, 2], 'ada')).toBe(0)
    expect(bestMatch(data, [0, 2], 'zzz')).toBeNull()
  })
})
