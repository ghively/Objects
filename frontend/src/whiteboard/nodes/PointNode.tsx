/**
 * `objectPoint`: a free-standing connector end (size 0). It shows as a small dot while
 * selected (our choice: hidden otherwise, so line and arrow ends stay clean), can be dragged,
 * has no visible handles and takes no new connections ("Points never take arrows").
 */
import { memo } from 'react'
import type { WhiteboardNodeProps } from '../canvasTypes'
import { NodeChrome } from './NodeChrome'

/** The dot's diameter and the grab area around it (our choice). */
export const POINT_DOT = 10
export const POINT_HIT = 20

function PointNodeImpl({ data, selected }: WhiteboardNodeProps) {
  return (
    <NodeChrome node={data.node} selected={!!selected}>
      <div
        className="absolute flex items-center justify-center"
        style={{ left: -POINT_HIT / 2, top: -POINT_HIT / 2, width: POINT_HIT, height: POINT_HIT }}
        data-testid="whiteboard-point-node"
      >
        <span
          className="block rounded-full"
          style={{
            width: POINT_DOT,
            height: POINT_DOT,
            background: 'var(--color-bg-front)',
            border: '2px solid var(--color-border-block-selection)',
            opacity: selected ? 1 : 0,
          }}
        />
      </div>
    </NodeChrome>
  )
}

export const PointNode = memo(PointNodeImpl)
