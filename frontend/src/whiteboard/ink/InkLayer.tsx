import { memo, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { useReactFlow, useViewport, ViewportPortal } from '@xyflow/react'
import {
  ERASER_RADIUS_PX,
  HIGHLIGHTER_OPACITY,
  finishStroke,
  hitStrokes,
  isBarrelButton,
  isEraserEnd,
  newStrokeId,
  outlineFor,
  samplesFrom,
  strokeOptions,
  svgPathFromOutline,
} from './inkModel'
import type { InkLayerProps, InkStroke, InkStrokeTool } from './types'

/** One stored stroke. Strokes never change in place, so memoizing on the object is exact. */
const StrokePath = memo(function StrokePath({ stroke }: { stroke: InkStroke }) {
  return (
    <path
      data-stroke-id={stroke.id}
      data-tool={stroke.tool}
      d={stroke.d}
      fill={stroke.color}
      fillOpacity={stroke.tool === 'highlighter' ? HIGHLIGHTER_OPACITY : undefined}
    />
  )
})

type Gesture = {
  pointerId: number
  pointerType: string
  mode: 'draw' | 'erase'
  tool: InkStrokeTool
  color: string
  width: number
  points: [number, number, number][]
}

type Live = { tool: InkStrokeTool; color: string; width: number; pointerType: string; points: [number, number, number][] }

function LivePath({ live }: { live: Live }) {
  const d = useMemo(
    () => svgPathFromOutline(outlineFor(live.points, strokeOptions(live.tool, live.width, live.pointerType))),
    [live],
  )
  return (
    <path
      data-ink-live=""
      d={d}
      fill={live.color}
      fillOpacity={live.tool === 'highlighter' ? HIGHLIGHTER_OPACITY : undefined}
    />
  )
}

const SVG_STYLE: CSSProperties = {
  position: 'absolute',
  left: 0,
  top: 0,
  width: 1,
  height: 1,
  overflow: 'visible',
  pointerEvents: 'none',
}

/**
 * The freehand ink layer, rendered as a child of `<ReactFlow>`. The strokes draw in flow
 * coordinates inside `ViewportPortal` (above nodes and connectors). While an ink tool is on and
 * the board is writable and not panning, a capture overlay over the pane turns pointer input
 * into strokes (pen pressure and coalesced samples) or erase gestures.
 */
export function InkLayer({ strokes, tool, readOnly, panning, onStrokesChange, onWheel }: InkLayerProps) {
  const { screenToFlowPosition } = useReactFlow()
  const { zoom } = useViewport()
  const [live, setLive] = useState<Live | null>(null)
  const gesture = useRef<Gesture | null>(null)
  /** Pens currently in contact (palm rejection: touch is ignored while one is down). */
  const pensDown = useRef(new Set<number>())
  const overlay = useRef<HTMLDivElement | null>(null)

  const latest = useRef({ strokes, tool, zoom, onStrokesChange, onWheel })
  latest.current = { strokes, tool, zoom, onStrokesChange, onWheel }

  const capturing = tool !== null && !readOnly && !panning

  // Leaving capture mode abandons a gesture in progress.
  useEffect(() => {
    if (!capturing) {
      gesture.current = null
      pensDown.current.clear()
      setLive(null)
    }
  }, [capturing])

  // Wheel: a native, non-passive listener so the canvas may preventDefault.
  useEffect(() => {
    const el = overlay.current
    if (!el) return
    const handler = (e: WheelEvent) => latest.current.onWheel(e)
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [capturing])

  const toFlow = (p: { x: number; y: number }) => screenToFlowPosition(p, { snapToGrid: false })

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const ev = e.nativeEvent
    const t = latest.current.tool
    if (!t) return
    if (ev.pointerType === 'touch' && pensDown.current.size > 0) return
    if (gesture.current) return
    const eraserEnd = isEraserEnd(ev)
    if (!eraserEnd) {
      if (isBarrelButton(ev)) return
      if (ev.pointerType === 'mouse' && ev.button !== 0) return
    }
    if (ev.pointerType === 'pen') pensDown.current.add(ev.pointerId)
    e.preventDefault()
    e.stopPropagation()
    try {
      e.currentTarget.setPointerCapture?.(ev.pointerId)
    } catch {
      /* jsdom or a pointer that is already gone */
    }
    const mode = eraserEnd || t.tool === 'eraser' ? 'erase' : 'draw'
    const drawTool: InkStrokeTool = t.tool === 'highlighter' ? 'highlighter' : 'pen'
    const g: Gesture = {
      pointerId: ev.pointerId,
      pointerType: ev.pointerType,
      mode,
      tool: drawTool,
      color: t.color,
      width: t.width,
      points: samplesFrom(ev, toFlow),
    }
    gesture.current = g
    if (mode === 'draw') setLive({ tool: g.tool, color: g.color, width: g.width, pointerType: g.pointerType, points: g.points })
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current
    const ev = e.nativeEvent
    if (!g || ev.pointerId !== g.pointerId) return
    g.points = g.points.concat(samplesFrom(ev, toFlow))
    if (g.mode === 'draw') setLive({ tool: g.tool, color: g.color, width: g.width, pointerType: g.pointerType, points: g.points })
  }

  const end = (e: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const ev = e.nativeEvent
    if (ev.pointerType === 'pen') pensDown.current.delete(ev.pointerId)
    const g = gesture.current
    if (!g || ev.pointerId !== g.pointerId) return
    gesture.current = null
    setLive(null)
    try {
      e.currentTarget.releasePointerCapture?.(ev.pointerId)
    } catch {
      /* not captured */
    }
    if (cancelled || g.points.length === 0) return
    const { strokes: current, zoom: z, onStrokesChange: change } = latest.current
    if (g.mode === 'draw') {
      change([...current, finishStroke(newStrokeId(), g.tool, g.color, g.width, g.points, g.pointerType)], 'draw')
      return
    }
    const hit = hitStrokes(current, g.points, ERASER_RADIUS_PX / (z || 1))
    if (hit.size > 0) change(current.filter((s) => !hit.has(s.id)), 'erase')
  }

  return (
    <>
      <ViewportPortal>
        <svg data-ink-layer="" style={SVG_STYLE} aria-hidden>
          {strokes.map((s) => (
            <StrokePath key={s.id} stroke={s} />
          ))}
          {live && <LivePath live={live} />}
        </svg>
      </ViewportPortal>
      {capturing && (
        <div
          ref={overlay}
          data-ink-capture=""
          data-ink-tool={tool.tool}
          className="nopan nodrag nowheel"
          style={{ position: 'absolute', inset: 0, zIndex: 4, touchAction: 'none', cursor: 'crosshair' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={(e) => end(e, false)}
          onPointerCancel={(e) => end(e, true)}
          onContextMenu={(e) => e.preventDefault()}
        />
      )}
    </>
  )
}
