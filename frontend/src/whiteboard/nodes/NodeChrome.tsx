/**
 * What every whiteboard node shares around its content: the four connection handles
 * (`top`/`right`/`bottom`/`left`, our choice of ids), the resizer with the kind's floor
 * (`minSizeFor`), and the rotation knob on shapes. The selection ring itself is CSS
 * (`whiteboard.css`: 3 px `--color-border-block-selection` on `.react-flow__node.selected`).
 *
 * Handles are always rendered, because React Flow positions a connector from the handles of
 * its two nodes; when the board or the node is locked (or the node is a point) they are hidden
 * and not connectable, and the resizer and knob are left out.
 */
import { Fragment, useRef, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { Handle, NodeResizer, Position } from '@xyflow/react'
import type { WhiteboardNode, WhiteboardNodeKind } from '@/api/whiteboardTypes'
import { AUTO_MAX_HEIGHT, AUTO_MAX_WIDTH, AUTO_MIN_WIDTH, AUTO_TEXT_MIN_HEIGHT, LINK_BLOCK_MIN_WIDTH, minSizeFor } from '../model'
import { isEditable, useBoardActions, useBoardState } from '../store'

export const HANDLE_IDS = ['top', 'right', 'bottom', 'left'] as const
export type HandleId = (typeof HANDLE_IDS)[number]

const POSITIONS: Record<HandleId, Position> = {
  top: Position.Top,
  right: Position.Right,
  bottom: Position.Bottom,
  left: Position.Left,
}

/** The resize floor of a node: its kind's (`minSizeFor`); an embedded object is at least 360 wide. */
export function resizeFloor(kind: WhiteboardNodeKind, entity = false): { width: number; height: number } {
  const min = minSizeFor(kind)
  return entity ? { width: Math.max(min.width, LINK_BLOCK_MIN_WIDTH), height: min.height } : min
}

/** Whether a block node still sizes itself to its content (no user-set size). */
export function isAutoSized(node: Pick<WhiteboardNode, 'width' | 'height'>): boolean {
  return typeof node.width !== 'number' && typeof node.height !== 'number'
}

/** The box style of a block node's frame: auto limits while unsized, else the pinned size. */
export function blockFrameStyle(node: Pick<WhiteboardNode, 'width' | 'height'>): CSSProperties {
  if (isAutoSized(node)) {
    return {
      width: 'max-content',
      minWidth: AUTO_MIN_WIDTH,
      maxWidth: AUTO_MAX_WIDTH,
      minHeight: AUTO_TEXT_MIN_HEIGHT,
      maxHeight: AUTO_MAX_HEIGHT,
    }
  }
  return {
    width: '100%',
    height: typeof node.height === 'number' ? '100%' : undefined,
    minHeight: typeof node.height === 'number' ? undefined : AUTO_TEXT_MIN_HEIGHT,
  }
}

/** Whether the node takes edits: the board is editable and the node itself isn't locked. */
export function useNodeEditable(node: WhiteboardNode): boolean {
  const boardEditable = useBoardState(isEditable)
  return boardEditable && node.locked !== true
}

/** Degrees between the centre and the pointer, 0 = straight up, in [0, 360). */
export function angleFrom(center: { x: number; y: number }, pointer: { x: number; y: number }, step = 1): number {
  const deg = (Math.atan2(pointer.y - center.y, pointer.x - center.x) * 180) / Math.PI + 90
  const snapped = Math.round(deg / step) * step
  return ((snapped % 360) + 360) % 360
}

/** A point's anchor: it holds connector ends but takes no new connections. */
const HIDDEN_HANDLE: CSSProperties = { opacity: 0, pointerEvents: 'none' }
const POINT_HANDLE: CSSProperties = {
  ...HIDDEN_HANDLE,
  left: 0,
  top: 0,
  right: 'auto',
  bottom: 'auto',
  width: 0,
  height: 0,
  minWidth: 0,
  minHeight: 0,
  transform: 'none',
}

function Handles({ visible, point }: { visible: boolean; point: boolean }) {
  if (point) {
    // One anchor at the point itself (source and target, so either end of a connector finds it).
    return (
      <>
        <Handle type="target" position={Position.Top} isConnectable={false} style={POINT_HANDLE} />
        <Handle type="source" position={Position.Top} isConnectable={false} style={POINT_HANDLE} />
      </>
    )
  }
  return (
    <>
      {HANDLE_IDS.map((id) => (
        // A target and a source per side with the same id: a connector can start or end on any side
        // (the source is rendered last, so a drag starts a connection from it).
        <Fragment key={id}>
          <Handle
            id={id}
            type="target"
            position={POSITIONS[id]}
            isConnectable={visible}
            style={visible ? undefined : HIDDEN_HANDLE}
          />
          <Handle
            id={id}
            type="source"
            position={POSITIONS[id]}
            isConnectable={visible}
            style={visible ? undefined : HIDDEN_HANDLE}
            data-whiteboard-handle={visible ? id : undefined}
          />
        </Fragment>
      ))}
    </>
  )
}

function RotationKnob({ node }: { node: WhiteboardNode }) {
  const actions = useBoardActions()
  const gesture = useRef<{ key: string; center: { x: number; y: number } } | null>(null)
  const seq = useRef(0)

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    const host = (e.currentTarget.closest('.react-flow__node') ?? e.currentTarget.parentElement) as HTMLElement | null
    const r = host?.getBoundingClientRect()
    if (!r) return
    seq.current++
    gesture.current = { key: `rotate:${node.id}:${seq.current}`, center: { x: r.left + r.width / 2, y: r.top + r.height / 2 } }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current
    if (!g) return
    e.stopPropagation()
    // Shift snaps to 15° steps (our choice).
    const rotation = angleFrom(g.center, { x: e.clientX, y: e.clientY }, e.shiftKey ? 15 : 1)
    actions.updateNode(node.id, { rotation }, g.key)
  }
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!gesture.current) return
    e.stopPropagation()
    gesture.current = null
    e.currentTarget.releasePointerCapture?.(e.pointerId)
  }

  return (
    <div
      className="nodrag nopan absolute left-1/2 flex -translate-x-1/2 items-center justify-center"
      style={{
        top: 'calc(-1 * var(--whiteboard-rotate-hit, 32px) - var(--whiteboard-handle-outset, 21px))',
        width: 'var(--whiteboard-rotate-hit, 32px)',
        height: 'var(--whiteboard-rotate-hit, 32px)',
        cursor: 'grab',
      }}
      data-whiteboard-rotate=""
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <span
        className="block rounded-full"
        style={{
          width: 'var(--whiteboard-rotate-knob, 16px)',
          height: 'var(--whiteboard-rotate-knob, 16px)',
          background: 'var(--color-bg-front)',
          border: 'var(--whiteboard-handle-stroke, 3px) solid var(--color-border-block-selection)',
        }}
      />
    </div>
  )
}

export interface NodeChromeProps {
  node: WhiteboardNode
  selected: boolean
  /** An embedded object (resize floor 360 wide). */
  entity?: boolean
  /** While the node's text is being edited the resizer and knob step aside. */
  editing?: boolean
  children: ReactNode
}

export function NodeChrome({ node, selected, entity, editing, children }: NodeChromeProps) {
  const editable = useNodeEditable(node)
  const point = node.kind === 'point'
  const floor = resizeFloor(node.kind, entity)
  const showResizer = editable && selected && !point && !editing
  return (
    <>
      {showResizer && (
        <NodeResizer
          minWidth={floor.width}
          minHeight={floor.height}
          isVisible
          color="var(--color-border-block-selection)"
          handleStyle={{
            width: 'var(--whiteboard-resize-handle-size, 12px)',
            height: 'var(--whiteboard-resize-handle-size, 12px)',
            borderRadius: 'var(--whiteboard-resize-handle-radius, 2px)',
          }}
          lineStyle={{ borderColor: 'transparent' }}
        />
      )}
      {showResizer && node.kind === 'shape' && <RotationKnob node={node} />}
      <Handles visible={editable && !point} point={point} />
      {children}
    </>
  )
}
