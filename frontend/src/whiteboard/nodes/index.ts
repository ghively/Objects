/**
 * The whiteboard's node components (Task 10), keyed by React Flow node type
 * (`canvasTypes.ts` `NODE_TYPE_KEYS`).
 */
import type { NodeTypes } from '../canvasTypes'
import { BlockNode } from './BlockNode'
import { FrameNode } from './FrameNode'
import { PointNode } from './PointNode'
import { ShapeNode } from './ShapeNode'

export const nodeTypes: NodeTypes = {
  boardBlock: BlockNode,
  boardShape: ShapeNode,
  boardFrame: FrameNode,
  boardPoint: PointNode,
}

export { BlockNode, FrameNode, PointNode, ShapeNode }
export { EntityNode } from './EntityNode'
export { MediaNode } from './MediaNode'
export { WeblinkNode } from './WeblinkNode'
export { NodeChrome } from './NodeChrome'
export { MarkdownView, TextBlockEditor } from './TextBlockEditor'
