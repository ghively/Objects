/**
 * STUB (Task 9): replaced in full by Task 11. The export names and prop types are final
 * (`canvasTypes.ts`): `edgeTypes` (the `connector` edge) and `MarkerDefs`.
 */
import { createElement } from 'react'
import { BaseEdge, getStraightPath } from '@xyflow/react'
import type { EdgeTypes, MarkerDefsProps, WhiteboardEdgeProps } from '../canvasTypes'

function StraightConnector({ id, sourceX, sourceY, targetX, targetY }: WhiteboardEdgeProps) {
  const [path] = getStraightPath({ sourceX, sourceY, targetX, targetY })
  return createElement(BaseEdge, { id, path })
}

export const edgeTypes: EdgeTypes = { connector: StraightConnector }

export function MarkerDefs(_props: MarkerDefsProps) {
  return null
}
