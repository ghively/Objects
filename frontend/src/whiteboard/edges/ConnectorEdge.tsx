/**
 * The `connector` edge: the path for its connection (unset = cornered), its line's dash array,
 * colour and tips, an invisible wide hit stroke (React Flow's interaction path), and the label at
 * the path midpoint. Double-click adds a label text block (`addEdgeLabel`) and edits it; an
 * emptied label removes its block (cleared again if the text is empty);
 * a deprecated `label` string renders and becomes a block when edited. Adding the block and
 * committing its text are one undo step.
 */
import { useRef, type MouseEvent } from 'react'
import { BaseEdge, EdgeLabelRenderer } from '@xyflow/react'
import type { WhiteboardEdge } from '@/api/whiteboardTypes'
import * as A from '../actions'
import type { WhiteboardEdgeProps } from '../canvasTypes'
import { isEditable, useBoardActions, useBoardState } from '../store'
import { EDGE_HIT_WIDTH, commitEdgeLabel, labelText, markerIds, pathFor, strokeFor } from './connectorStyle'
import { EdgeLabel } from './EdgeLabel'

let editSeq = 0

export function ConnectorEdge(props: WhiteboardEdgeProps) {
  const { id, data, selected, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition } = props
  const edge: WhiteboardEdge = data?.edge ?? { id, source: props.source, target: props.target }
  const actions = useBoardActions()
  const editing = useBoardState((s) => s.editingId === id)
  const editable = useBoardState(isEditable)
  const editKey = useRef<string | null>(null)

  const { path, labelX, labelY } = pathFor(edge.connection, { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition })
  const tips = markerIds(edge, !!selected)
  const text = labelText(edge, data?.block)

  const startEdit = (e?: MouseEvent) => {
    e?.stopPropagation()
    if (!editable || editing) return
    const key = `label:${id}:${++editSeq}`
    editKey.current = key
    actions.beginEdit(id)
    actions.apply('label', (b) => A.addEdgeLabel(b, id), key)
  }

  const commit = (next: string) => {
    const key = editKey.current ?? `label:${id}:${++editSeq}`
    editKey.current = null
    actions.apply('label', (b) => commitEdgeLabel(b, id, next), key)
    actions.endEdit()
  }

  return (
    <>
      <g
        data-whiteboard-connector={id}
        data-connection={edge.connection ?? 'cornered'}
        data-selected={selected ? 'true' : undefined}
        onDoubleClick={startEdit}
      >
        <BaseEdge
          id={id}
          path={path}
          style={strokeFor(edge, { selected: !!selected })}
          markerStart={tips.start ? `url(#${tips.start})` : undefined}
          markerEnd={tips.end ? `url(#${tips.end})` : undefined}
          interactionWidth={EDGE_HIT_WIDTH}
        />
      </g>
      {(editing || (text !== null && text !== '')) && (
        <EdgeLabelRenderer>
          <EdgeLabel
            edgeId={id}
            x={labelX}
            y={labelY}
            text={text ?? ''}
            editing={editing}
            selected={!!selected}
            onStartEdit={startEdit}
            onCommit={commit}
          />
        </EdgeLabelRenderer>
      )}
    </>
  )
}
