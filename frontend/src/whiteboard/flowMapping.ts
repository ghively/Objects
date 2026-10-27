/**
 * Projection between the board file (`WhiteboardData`) and React Flow's nodes and edges.
 * Pure: types only from `@xyflow/react`. The node `type` names are Object's Vue Flow node
 * types (the `object*` classes in its CSS). `data.node`/`data.edge` hold the original
 * objects, so nothing the projection doesn't understand is lost.
 */
import type { Edge, Node, NodeChange } from '@xyflow/react'
import type {
  WhiteboardBlock,
  WhiteboardData,
  WhiteboardEdge,
  WhiteboardNode,
  WhiteboardNodeKind,
} from '@/api/whiteboardTypes'

/** What the canvas edits: the board plus the ink strokes (typed by the ink plugin). */
export interface BoardDoc {
  board: WhiteboardData
  strokes: unknown[]
}

export const FLOW_NODE_TYPES = {
  block: 'objectBlock',
  shape: 'objectShape',
  frame: 'objectFrame',
  point: 'objectPoint',
} as const satisfies Record<WhiteboardNodeKind, string>

export type FlowNodeType = (typeof FLOW_NODE_TYPES)[WhiteboardNodeKind]
export const FLOW_EDGE_TYPE = 'connector'

export interface FlowNodeData extends Record<string, unknown> {
  node: WhiteboardNode
  block?: WhiteboardBlock
}

export interface FlowEdgeData extends Record<string, unknown> {
  edge: WhiteboardEdge
  block?: WhiteboardBlock
}

export type FlowNode = Node<FlowNodeData, FlowNodeType>
export type FlowEdge = Edge<FlowEdgeData, typeof FLOW_EDGE_TYPE>

export function flowNodeType(kind: WhiteboardNodeKind | string): FlowNodeType {
  return (FLOW_NODE_TYPES as Record<string, FlowNodeType>)[kind] ?? FLOW_NODE_TYPES.block
}

export function toFlowNode(n: WhiteboardNode, blocks: WhiteboardData['blocks'], selected?: boolean): FlowNode {
  const out: FlowNode = {
    id: n.id,
    type: flowNodeType(n.kind),
    position: { x: n.position.x, y: n.position.y },
    data: n.blockId !== undefined && blocks[n.blockId] ? { node: n, block: blocks[n.blockId] } : { node: n },
  }
  if (typeof n.width === 'number') out.width = n.width
  if (typeof n.height === 'number') out.height = n.height
  if (typeof n.z === 'number') out.zIndex = n.z
  if (n.locked) {
    out.draggable = false
    out.deletable = false
  }
  if (selected) out.selected = true
  return out
}

export function toFlowEdge(e: WhiteboardEdge, blocks: WhiteboardData['blocks'], selected?: boolean): FlowEdge {
  const out: FlowEdge = {
    id: e.id,
    source: e.source,
    target: e.target,
    type: FLOW_EDGE_TYPE,
    data: e.blockId !== undefined && blocks[e.blockId] ? { edge: e, block: blocks[e.blockId] } : { edge: e },
  }
  if (e.sourceHandle !== undefined) out.sourceHandle = e.sourceHandle
  if (e.targetHandle !== undefined) out.targetHandle = e.targetHandle
  if (selected) out.selected = true
  return out
}

/** The React Flow projection of a board; `selected` marks the store's selection. */
export function toFlow(
  board: WhiteboardData,
  selected?: ReadonlySet<string>,
): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const blocks = board.blocks ?? {}
  const nodes: FlowNode[] = []
  const edges: FlowEdge[] = []
  for (const id in board.nodes) nodes.push(toFlowNode(board.nodes[id], blocks, selected?.has(id)))
  for (const id in board.edges) edges.push(toFlowEdge(board.edges[id], blocks, selected?.has(id)))
  return { nodes, edges }
}

/**
 * Applies React Flow's position and size changes to the board. Only fields that actually changed
 * are rewritten (every other key, known or not, is kept), unchanged nodes keep their identity and
 * the board itself is returned as is when nothing changed. Selection, add, remove and replace
 * changes are ignored (the store owns those), and so are size changes from measuring: only a
 * resize (`resizing` or `setAttributes`) writes `width`/`height`.
 */
export function fromFlowChange(board: WhiteboardData, changes: readonly NodeChange[]): WhiteboardData {
  let nodes: Record<string, WhiteboardNode> | null = null
  const current = (id: string): WhiteboardNode | undefined => (nodes ?? board.nodes)[id]
  const put = (n: WhiteboardNode) => {
    if (!nodes) nodes = { ...board.nodes }
    nodes[n.id] = n
  }
  for (const c of changes) {
    if (c.type === 'position') {
      const n = current(c.id)
      if (!n || !c.position) continue
      const { x, y } = c.position
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue
      if (n.position.x === x && n.position.y === y) continue
      put({ ...n, position: { ...n.position, x, y } })
    } else if (c.type === 'dimensions') {
      const n = current(c.id)
      if (!n || !c.dimensions) continue
      if (!c.resizing && !c.setAttributes) continue
      const setW = c.setAttributes !== 'height'
      const setH = c.setAttributes !== 'width'
      const { width, height } = c.dimensions
      let next = n
      if (setW && Number.isFinite(width) && width > 0 && n.width !== width) next = { ...next, width }
      if (setH && Number.isFinite(height) && height > 0 && n.height !== height) next = { ...next, height }
      if (next !== n) put(next)
    }
  }
  return nodes ? { ...board, nodes } : board
}
