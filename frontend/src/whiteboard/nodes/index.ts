/**
 * STUB (Task 9): replaced in full by Task 10. The export name and prop types are final
 * (`canvasTypes.ts`): `nodeTypes` maps Object's four node types to node components.
 */
import { createElement } from 'react'
import type { NodeTypes, WhiteboardNodeProps } from '../canvasTypes'

function PlainNode({ data, type }: WhiteboardNodeProps) {
  return createElement('div', {
    'data-node-kind': data.node.kind,
    'data-node-type': type,
    style: { width: '100%', height: '100%', border: '1px solid var(--color-border-base)' },
  })
}

export const nodeTypes: NodeTypes = {
  objectBlock: PlainNode,
  objectShape: PlainNode,
  objectFrame: PlainNode,
  objectPoint: PlainNode,
}
