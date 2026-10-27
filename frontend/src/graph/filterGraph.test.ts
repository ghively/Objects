import { describe, expect, test } from 'vitest'
import type { GraphData, GraphNode } from '@/api/types'
import { bigGraph } from './__fixtures__/bigGraph'
import {
  INDIRECT_MAX_EDGES,
  INDIRECT_MAX_NEIGHBOURS,
  LARGE_NODE_LIMIT,
  bestMatch,
  filterGraph,
  titleScore,
} from './filterGraph'

function node(path: string, partial: Partial<GraphNode> = {}): GraphNode {
  return { path, title: path, type: 'page', icon: null, degree: 0, tag: false, daily: false, done: false, ...partial }
}

function graph(nodes: GraphNode[], links: [number, number][], tagged: [number, number][] = []): GraphData {
  const flat = links.flatMap(([a, b]) => (a < b ? [a, b] : [b, a]))
  const deg = nodes.map(() => 0)
  for (const [a, b] of links) {
    deg[a] += 1
    deg[b] += 1
  }
  return {
    nodes: nodes.map((n, i) => ({ ...n, degree: n.degree || deg[i] })),
    links: flat,
    tagged: tagged.flat(),
  }
}

const G = { kind: 'global' } as const

describe('filterGraph', () => {
  test('type filter and exclude, exclude wins', () => {
    const data = graph(
      [node('a', { type: 'page' }), node('b', { type: 'person' }), node('c', { type: 'project' })],
      [[0, 1], [1, 2]],
    )
    expect(filterGraph(data, {}, G).nodes).toEqual([0, 1, 2])
    expect(filterGraph(data, { filterStructureIds: ['page', 'person'] }, G).nodes).toEqual([0, 1])
    expect(filterGraph(data, { excludeStructureIds: ['person'] }, G).nodes).toEqual([0, 2])
    // Listed in both: still excluded.
    expect(filterGraph(data, { filterStructureIds: ['page', 'person'], excludeStructureIds: ['person'] }, G).nodes).toEqual([0])
    // Only links between shown nodes.
    expect(filterGraph(data, { filterStructureIds: ['page', 'person'] }, G).links).toEqual([[0, 1]])
  })

  test('completed tasks hidden by default and shown with the switch', () => {
    const data = graph([node('t1', { type: 'task', done: true }), node('t2', { type: 'task' })], [[0, 1]])
    expect(filterGraph(data, {}, G).nodes).toEqual([1])
    expect(filterGraph(data, { showCompletedTasks: true }, G).nodes).toEqual([0, 1])
  })

  test('hide dates hides daily notes; hide large nodes uses the limit', () => {
    const data = graph(
      [node('d', { daily: true }), node('hub', { degree: LARGE_NODE_LIMIT + 1 }), node('edge', { degree: LARGE_NODE_LIMIT })],
      [],
    )
    expect(filterGraph(data, {}, G).nodes).toEqual([0, 1, 2])
    expect(filterGraph(data, { hideDates: true }, G).nodes).toEqual([1, 2])
    expect(filterGraph(data, { hideLargeNodes: true }, G).nodes).toEqual([0, 2])
  })

  test('indirect links through a hidden node, capped by neighbours and total; hideIndirectLinks drops them', () => {
    // a — x — b, x hidden (excluded type), a and b shown: one indirect a–b.
    const small = graph([node('a'), node('x', { type: 'hidden' }), node('b')], [[0, 1], [1, 2]])
    const v = filterGraph(small, { excludeStructureIds: ['hidden'] }, G)
    expect(v.nodes).toEqual([0, 2])
    expect(v.links).toEqual([])
    expect(v.indirect).toEqual([[0, 2]])
    expect(filterGraph(small, { excludeStructureIds: ['hidden'], hideIndirectLinks: true }, G).indirect).toEqual([])

    // A direct link already joins them: no indirect duplicate.
    const direct = graph([node('a'), node('x', { type: 'hidden' }), node('b')], [[0, 1], [1, 2], [0, 2]])
    expect(filterGraph(direct, { excludeStructureIds: ['hidden'] }, G).indirect).toEqual([])

    // A hidden hub with more than the cap of shown neighbours adds nothing.
    const k = INDIRECT_MAX_NEIGHBOURS + 1
    const hubNodes = [node('hub', { type: 'hidden' }), ...Array.from({ length: k }, (_, i) => node(`n${i}`))]
    const hub = graph(hubNodes, Array.from({ length: k }, (_, i) => [0, i + 1] as [number, number]))
    expect(filterGraph(hub, { excludeStructureIds: ['hidden'] }, G).indirect).toEqual([])
    // At the cap it adds every pair.
    const atCap = graph(hubNodes.slice(0, INDIRECT_MAX_NEIGHBOURS + 1), Array.from({ length: INDIRECT_MAX_NEIGHBOURS }, (_, i) => [0, i + 1] as [number, number]))
    const n = INDIRECT_MAX_NEIGHBOURS
    expect(filterGraph(atCap, { excludeStructureIds: ['hidden'] }, G).indirect).toHaveLength((n * (n - 1)) / 2)

    // The total is capped.
    const many: GraphNode[] = []
    const links: [number, number][] = []
    // 1200 hidden hubs × 45 pairs each over disjoint groups of 10 = 54,000 candidate pairs.
    for (let h = 0; h < 1200; h++) {
      const hubIdx = many.length
      many.push(node(`h${h}`, { type: 'hidden' }))
      for (let j = 0; j < 10; j++) {
        links.push([hubIdx, many.length])
        many.push(node(`h${h}-${j}`))
      }
    }
    expect(filterGraph(graph(many, links), { excludeStructureIds: ['hidden'] }, G).indirect).toHaveLength(INDIRECT_MAX_EDGES)
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
    expect(v.indirect.length).toBeGreaterThan(0)
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
