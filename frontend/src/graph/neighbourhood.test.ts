import { describe, expect, test } from 'vitest'
import type { GraphData, GraphNode } from '@/api/types'
import { filterGraph } from './filterGraph'
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
    const hidden = filterGraph(DATA, { excludeStructureIds: ['page'] }, { kind: 'local', center: 1, hops: 1 })
    expect(hidden.nodes).toEqual([1])
  })

  test('an out-of-range centre is empty', () => {
    expect(neighbourhood(DATA, 99, 1, false).size).toBe(0)
  })
})
