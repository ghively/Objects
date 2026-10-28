import type { NodeChange } from '@xyflow/react'
import { describe, expect, test } from 'vitest'
import type { WhiteboardData, WhiteboardNode } from '@/api/whiteboardTypes'
import { FLOW_EDGE_TYPE, fromFlowChange, toFlow, type FlowEdge, type FlowNode } from './flowMapping'
import { board, edge, fixtureBoards, node, textBlock } from './test/boards'

/** The board rebuilt from its projection: the original objects, with the flow geometry written back. */
function fromFlow(original: WhiteboardData, nodes: FlowNode[], edges: FlowEdge[]): WhiteboardData {
  const changes: NodeChange[] = []
  for (const n of nodes) {
    changes.push({ type: 'position', id: n.id, position: { ...n.position } })
    if (typeof n.width === 'number' && typeof n.height === 'number') {
      changes.push({ type: 'dimensions', id: n.id, dimensions: { width: n.width, height: n.height }, setAttributes: true })
    }
  }
  const moved = fromFlowChange(original, changes)
  const blocks: WhiteboardData['blocks'] = {}
  for (const n of nodes) if (n.data.block && n.data.node.blockId) blocks[n.data.node.blockId] = n.data.block
  for (const e of edges) if (e.data?.block && e.data.edge.blockId) blocks[e.data.edge.blockId] = e.data.block
  return {
    ...moved,
    nodes: Object.fromEntries(nodes.map((n) => [n.id, moved.nodes[n.id]])),
    edges: Object.fromEntries(edges.map((e) => [e.id, e.data!.edge])),
    blocks: { ...original.blocks, ...blocks },
  }
}

describe('toFlow / fromFlowChange', () => {
  test('projection round trip is identity on every fixture board', () => {
    for (const { name, board: b } of fixtureBoards()) {
      const before = structuredClone(b)
      const { nodes, edges } = toFlow(b)
      expect(nodes.length, name).toBe(Object.keys(b.nodes).length)
      expect(edges.length, name).toBe(Object.keys(b.edges).length)
      const changes: NodeChange[] = nodes.map((n) => ({ type: 'position', id: n.id, position: { ...n.position } }))
      expect(fromFlowChange(b, changes), name).toBe(b)
      expect(fromFlow(b, nodes, edges), name).toEqual(before)
      expect(b, name).toEqual(before) // the projection never mutates the board
    }
  })

  test('node and edge types, z, data and locked flags', () => {
    const b = fixtureBoards()[0].board
    const { nodes, edges } = toFlow(b, new Set(['n-text']))
    const types = new Set(nodes.map((n) => n.type))
    expect(types).toEqual(new Set(['capacitiesBlock', 'capacitiesShape', 'capacitiesFrame', 'capacitiesPoint']))
    for (const n of nodes) {
      const src = b.nodes[n.id]
      expect(n.data.node).toBe(src)
      expect(n.zIndex).toBe(src.z)
      if (src.blockId) expect(n.data.block).toBe(b.blocks[src.blockId])
      expect(n.selected === true).toBe(n.id === 'n-text')
    }
    for (const e of edges) {
      expect(e.type).toBe(FLOW_EDGE_TYPE)
      expect(e.data!.edge).toBe(b.edges[e.id])
    }
    const locked = toFlow(board([node({ id: 'l', locked: true })])).nodes[0]
    expect(locked.draggable).toBe(false)
    expect(locked.deletable).toBe(false)
  })

  test('unknown node and edge keys survive the projection', () => {
    const b = board(
      [
        node({ id: 'a', blockId: 'ba', width: 420, height: 60, 'x-future': { deep: [1, 2] } } as Partial<WhiteboardNode>),
        node({ id: 'b', kind: 'shape', shape: 'star', position: { x: 90, y: 90 } }),
      ],
      [edge({ id: 'e', source: 'a', target: 'b', 'x-edge': 'kept' })],
      { ba: { ...textBlock('hi'), 'x-block': true } },
      { 'x-top': 3 },
    )
    const { nodes, edges } = toFlow(b)
    const moved = fromFlowChange(b, [
      { type: 'position', id: 'a', position: { x: 30, y: 60 } },
      { type: 'dimensions', id: 'a', dimensions: { width: 480, height: 90 }, resizing: true },
    ])
    expect(moved.nodes.a).toEqual({ ...b.nodes.a, position: { x: 30, y: 60 }, width: 480, height: 90 })
    expect(moved.nodes.a['x-future']).toEqual({ deep: [1, 2] })
    expect(moved.nodes.b).toBe(b.nodes.b)
    expect(moved['x-top']).toBe(3)
    expect(moved.edges).toBe(b.edges)
    expect(fromFlow(b, nodes, edges)).toEqual(b)
  })

  test('selection, measuring and changes for unknown nodes are ignored', () => {
    const b = board([node({ id: 'a', width: 420, height: 60 })])
    const out = fromFlowChange(b, [
      { type: 'select', id: 'a', selected: true },
      { type: 'dimensions', id: 'a', dimensions: { width: 500, height: 70 } },
      { type: 'position', id: 'missing', position: { x: 1, y: 1 } },
      { type: 'position', id: 'a' },
      { type: 'remove', id: 'a' },
    ])
    expect(out).toBe(b)
  })

  test('projection of 5000 nodes under 50 ms', () => {
    const nodes: WhiteboardNode[] = []
    const blocks: WhiteboardData['blocks'] = {}
    for (let i = 0; i < 5000; i++) {
      nodes.push(node({ id: `n${i}`, blockId: `b${i}`, position: { x: (i % 100) * 30, y: Math.floor(i / 100) * 30 }, width: 90, height: 60, z: i + 1 }))
      blocks[`b${i}`] = textBlock(`node ${i}`)
    }
    const edges = Array.from({ length: 2000 }, (_, i) => edge({ id: `e${i}`, source: `n${i}`, target: `n${i + 1}` }))
    const b = board(nodes, edges, blocks)
    toFlow(b) // warm up
    let best = Infinity
    for (let run = 0; run < 3; run++) {
      const t0 = performance.now()
      const flow = toFlow(b)
      best = Math.min(best, performance.now() - t0)
      expect(flow.nodes).toHaveLength(5000)
    }
    expect(best).toBeLessThan(50)
  })
})
