import { describe, expect, test } from 'vitest'
import type { GraphData, GraphNode } from '@/api/types'
import { filterGraph, LARGE_NODE_LIMIT, TAG_BACKLINK_LIMIT } from './filterGraph'
import { neighbourhood } from './neighbourhood'

function node(path: string, partial: Partial<GraphNode> = {}): GraphNode {
  return { path, title: path, type: 'page', icon: null, degree: 1, tag: false, daily: false, done: false, ...partial }
}

// 0 — 1 — 2 — 3, plus tag 4 tagging 0 and 5 (5 has no links).
const DATA: GraphData = {
  nodes: [node('a'), node('b'), node('c'), node('d'), node('t', { type: 'tag', tag: true }), node('e')],
  links: [0, 1, 1, 2, 2, 3],
  tagged: [0, 4, 5, 4],
}

describe('neighbourhood', () => {
  test('neighbourhood one and two hops; tag centre with tags network includes tagged objects; centre never hidden', () => {
    expect([...neighbourhood(DATA, 1, 1, false)].sort()).toEqual([0, 1, 2])
    expect([...neighbourhood(DATA, 1, 2, false)].sort()).toEqual([0, 1, 2, 3])
    expect([...neighbourhood(DATA, 4, 1, false)]).toEqual([4])
    expect([...neighbourhood(DATA, 4, 1, true)].sort()).toEqual([0, 4, 5])

    // Local scope: one hop, and the tags network on a tag centre.
    expect(filterGraph(DATA, {}, { kind: 'local', center: 1, hops: 1 }).nodes).toEqual([0, 1, 2])
    expect(filterGraph(DATA, {}, { kind: 'local', center: 1, hops: 2 }).nodes).toEqual([0, 1, 2, 3])
    const tagLocal = filterGraph(DATA, { showTagsNetwork: true }, { kind: 'local', center: 4, hops: 1 })
    expect(tagLocal.nodes).toEqual([0, 4, 5])
    expect(tagLocal.tagLinks).toEqual([[0, 4], [4, 5]])
    // showSpaceTagsNetwork is the global key; it doesn't widen a local graph.
    expect(filterGraph(DATA, { showSpaceTagsNetwork: true }, { kind: 'local', center: 4, hops: 1 }).nodes).toEqual([4])

    // The centre stays even when a filter would hide it; its hidden neighbours don't.
    const hidden = filterGraph(DATA, { excludeTypeIds: ['page'] }, { kind: 'local', center: 1, hops: 1 })
    expect(hidden.nodes).toEqual([1])
  })

  test('walks up to five hops; completed tasks are not walked unless shown', () => {
    // A chain 0 — 1 — … — 7.
    const chain: GraphData = {
      nodes: Array.from({ length: 8 }, (_, i) => node(`c${i}`)),
      links: Array.from({ length: 7 }, (_, i) => [i, i + 1]).flat(),
      tagged: [],
    }
    expect(neighbourhood(chain, 0, 5, false).size).toBe(6)
    expect(filterGraph(chain, {}, { kind: 'local', center: 0, hops: 5 }).nodes).toEqual([0, 1, 2, 3, 4, 5])
    const withDone: GraphData = { ...chain, nodes: chain.nodes.map((n, i) => (i === 1 ? { ...n, type: 'task', done: true } : n)) }
    expect([...neighbourhood(withDone, 0, 3, false, {})]).toEqual([0])
    expect(neighbourhood(withDone, 0, 3, false, { showCompletedTasks: true }).size).toBe(4)
  })

  test('with "Hide heavily linked notes" the walk does not go on from a large node', () => {
    // 0 — hub(1) — 21 leaves; the hub links each leaf.
    const leaves = LARGE_NODE_LIMIT + 1
    const data: GraphData = {
      nodes: [node('a'), node('hub'), ...Array.from({ length: leaves }, (_, i) => node(`l${i}`))],
      links: [0, 1, ...Array.from({ length: leaves }, (_, i) => [1, i + 2]).flat()],
      linkDirs: [2, ...Array.from({ length: leaves }, () => 1)],
      tagged: [],
    }
    expect(neighbourhood(data, 0, 2, false, {}).size).toBe(leaves + 2)
    expect([...neighbourhood(data, 0, 2, false, { hideLargeNodes: true })].sort((x, y) => x - y)).toEqual([0, 1])
    // The centre itself, when large, isn't expanded either (every walked node is checked).
    expect([...neighbourhood(data, 1, 1, false, { hideLargeNodes: true })]).toEqual([1])
  })

  test('a tag other than the centre with 10 or more backlinks is not walked through its backlinks', () => {
    // a links tag t; ten more objects link t too.
    const k = TAG_BACKLINK_LIMIT
    const data: GraphData = {
      nodes: [node('a'), node('t', { type: 'tag', tag: true }), ...Array.from({ length: k }, (_, i) => node(`o${i}`))],
      links: [0, 1, ...Array.from({ length: k }, (_, i) => [1, i + 2]).flat()],
      linkDirs: [1, ...Array.from({ length: k }, () => 2)],
      tagged: [],
    }
    expect([...neighbourhood(data, 0, 2, false, {})].sort((x, y) => x - y)).toEqual([0, 1])
    // As the centre, its backlinks are walked.
    expect(neighbourhood(data, 1, 1, false, {}).size).toBe(k + 2)
  })

  test('an out-of-range centre is empty', () => {
    expect(neighbourhood(DATA, 99, 1, false).size).toBe(0)
  })
})
