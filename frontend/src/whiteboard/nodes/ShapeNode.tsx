/**
 * `objectShape`: one of the 12 shapes (`shapePath`), filled with its `fillColor`, outlined
 * in its `borderColor` (else the default ring), rotated and flipped. In-shape text sits in the
 * shape's `textInset` box, aligned vertically by `textVerticalAlign` (unset = center).
 *
 * Gates are rectangles whose text is exactly a gate label ("Persist as `rectangle` plus this exact
 * label"): the label shows centred, and HIGH / LOW carry `data-circuit-bit` for the circuit ring.
 * How the gates are drawn beyond that is not in the trimmed reference (our choice: a labelled
 * rectangle).
 */
import { memo, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react'
import type { WhiteboardShape, WhiteboardTextBlock, WhiteboardTextVerticalAlign } from '@/api/whiteboardTypes'
import { nodeBox } from '../actions'
import type { WhiteboardNodeProps } from '../canvasTypes'
import { borderStyle, fillValue } from '../colors'
import { circuitLabelOf, isShapeTool } from '../model'
import { shapePath, textInset } from '../shapes'
import { useBoardActions, useBoardState } from '../store'
import { commitText } from './BlockNode'
import { NodeChrome, useNodeEditable } from './NodeChrome'
import { MarkdownView, TextBlockEditor } from './TextBlockEditor'

/** A shape with no `fillColor` shows the panel colour (our choice; Object's default isn't in the reference). */
export const DEFAULT_SHAPE_FILL = 'var(--color-bg-base)'

const JUSTIFY: Record<WhiteboardTextVerticalAlign, CSSProperties['justifyContent']> = {
  top: 'flex-start',
  center: 'center',
  bottom: 'flex-end',
}

function ShapeNodeImpl({ id, data, selected, width, height }: WhiteboardNodeProps) {
  const node = data.node
  const block = data.block?.type === 'text' ? (data.block as WhiteboardTextBlock) : undefined
  const actions = useBoardActions()
  const editing = useBoardState((s) => s.editingId === id)
  const blocks = useBoardState((s) => s.doc.board.blocks)
  const editable = useNodeEditable(node)

  const box = nodeBox(node)
  const w = typeof width === 'number' && width > 0 ? width : box.width
  const h = typeof height === 'number' && height > 0 ? height : box.height
  const shape: WhiteboardShape = isShapeTool(node.shape) ? node.shape : 'rectangle'
  const flip = { flipX: node.flipX === true, flipY: node.flipY === true }
  const inset = textInset(shape, w, h, flip)
  const gate = circuitLabelOf(node, blocks)
  const bit = gate === 'high' ? '1' : gate === 'low' ? '0' : undefined
  const vAlign: WhiteboardTextVerticalAlign = gate ? 'center' : (node.textVerticalAlign ?? 'center')
  const rotation = typeof node.rotation === 'number' && Number.isFinite(node.rotation) ? node.rotation : 0
  const fill = fillValue(node.fillColor) ?? DEFAULT_SHAPE_FILL

  const onDoubleClick = (e: ReactMouseEvent) => {
    if (!editable) return
    e.stopPropagation()
    actions.select([id])
    actions.beginEdit(id)
  }

  return (
    <NodeChrome node={node} selected={!!selected} editing={editing}>
      <div
        className="whiteboard-shape-surface relative h-full w-full"
        style={{
          width: w,
          height: h,
          transform: rotation ? `rotate(${rotation}deg)` : undefined,
          ...borderStyle(node.borderColor),
        }}
        data-shape={shape}
        data-rotation={rotation || undefined}
        data-flip-x={flip.flipX ? '' : undefined}
        data-flip-y={flip.flipY ? '' : undefined}
        data-circuit-bit={bit}
        data-gate={gate ?? undefined}
        data-testid="whiteboard-shape-node"
        onDoubleClick={onDoubleClick}
      >
        <svg className="absolute inset-0 overflow-visible" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
          <path d={shapePath(shape, w, h, flip)} fill={fill} strokeLinejoin="round" data-fill={node.fillColor ?? undefined} />
        </svg>
        <div
          className="absolute flex flex-col overflow-hidden text-[15px] leading-[1.5] text-fg"
          style={{
            left: inset.x,
            top: inset.y,
            width: inset.width,
            height: inset.height,
            justifyContent: JUSTIFY[vAlign],
            padding: 4,
            boxSizing: 'border-box',
          }}
          data-text-valign={vAlign}
          data-testid="whiteboard-shape-text"
        >
          {editing ? (
            <TextBlockEditor
              markdown={block?.markdown ?? ''}
              align={block?.align ?? 'center'}
              onCommit={(md) => commitText(actions, id, data.block, md)}
            />
          ) : gate ? (
            <div className="text-center font-semibold tracking-wide" data-gate-label="">
              {block?.markdown}
            </div>
          ) : block ? (
            <MarkdownView markdown={block.markdown} align={block.align ?? 'center'} />
          ) : null}
        </div>
      </div>
    </NodeChrome>
  )
}

export const ShapeNode = memo(ShapeNodeImpl)
