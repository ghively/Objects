/**
 * The whiteboard's node components (Task 10), keyed by Capacities' Vue Flow node type names
 * (`canvasTypes.ts` `NODE_TYPE_KEYS`).
 */
import type { NodeTypes } from '../canvasTypes'
import { BlockNode } from './BlockNode'
import { FrameNode } from './FrameNode'
import { PointNode } from './PointNode'
import { ShapeNode } from './ShapeNode'

export const nodeTypes: NodeTypes = {
  capacitiesBlock: BlockNode,
  capacitiesShape: ShapeNode,
  capacitiesFrame: FrameNode,
  capacitiesPoint: PointNode,
}

export { BlockNode, FrameNode, PointNode, ShapeNode }
export { EntityNode } from './EntityNode'
export { MediaNode } from './MediaNode'
export { WeblinkNode } from './WeblinkNode'
export { NodeChrome } from './NodeChrome'
export { MarkdownView, TextBlockEditor } from './TextBlockEditor'
