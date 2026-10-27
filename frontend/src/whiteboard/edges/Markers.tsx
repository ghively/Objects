/**
 * The SVG `<marker>` definitions for connector tips: arrow, dot and double arrow, one definition
 * per tip kind and colour in use (plus the selection colour, so a selected connector's tips
 * follow its stroke). `orient="auto-start-reverse"` lets one definition serve the start and the
 * end. The tip drawings are our choice (the trimmed reference has no marker drawing).
 */
import type { MarkerDefsProps } from '../canvasTypes'
import { TIP_SHAPES, colorForKey, markerId, markersInUse } from './connectorStyle'

export function MarkerDefs({ edges }: MarkerDefsProps) {
  const markers = markersInUse(edges)
  if (markers.length === 0) return null
  return (
    <svg
      aria-hidden="true"
      data-whiteboard-markers=""
      style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden', pointerEvents: 'none' }}
    >
      <defs>
        {markers.map(({ kind, color }) => {
          const t = TIP_SHAPES[kind]
          const paint = colorForKey(color)
          return (
            <marker
              key={markerId(kind, color)}
              id={markerId(kind, color)}
              data-tip={kind}
              data-color={color}
              viewBox={t.viewBox}
              markerWidth={t.width}
              markerHeight={t.height}
              refX={t.refX}
              refY={t.refY}
              markerUnits="userSpaceOnUse"
              orient="auto-start-reverse"
            >
              <path d={t.d} style={{ fill: paint, stroke: 'none' }} />
            </marker>
          )
        })}
      </defs>
    </svg>
  )
}
