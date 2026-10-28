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
  splitPoints,
  strokeOptions,
  svgPathFromOutline,
} from './inkModel'
import { erasePartially } from './inkErase'
import {
  INK_HANDLE_PX,
  corners,
  cornerScale,
  deleteStrokes,
  handleAt,
  lassoSelect,
  oppositeCorner,
  scaleStrokes,
  selectionBounds,
  strokeAt,
  translateStrokes,
  type Corner,
} from './inkSelect'
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
  mode: 'draw' | 'erase' | 'lasso' | 'move' | 'scale'
  /** The eraser cuts strokes instead of removing them whole. */
  partial?: boolean
  /** A scale gesture's corner and the selection box it started from. */
  corner?: Corner
  start?: { x: number; y: number }
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
  /** The ink selection (the Select ink tool); ids of strokes that no longer exist drop out. */
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set())
  /** The lasso path, or the live move / scale preview of the selection. */
  const [lasso, setLasso] = useState<[number, number, number][] | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const selecting = tool?.tool === 'select'
  const gesture = useRef<Gesture | null>(null)
  /** Pens currently in contact (palm rejection: touch is ignored while one is down). */
  const pensDown = useRef(new Set<number>())
  const overlay = useRef<HTMLDivElement | null>(null)

  const selection = useMemo(() => {
    if (!selecting || picked.size === 0) return picked.size === 0 ? picked : new Set<string>()
    const have = new Set(strokes.map((s) => s.id))
    return new Set([...picked].filter((id) => have.has(id)))
  }, [picked, strokes, selecting])
  const box = useMemo(() => (selection.size ? selectionBounds(strokes, selection) : null), [strokes, selection])

  const latest = useRef({ strokes, tool, zoom, onStrokesChange, onWheel, selection, box })
  latest.current = { strokes, tool, zoom, onStrokesChange, onWheel, selection, box }

  const capturing = tool !== null && !readOnly && !panning

  // Leaving the Select ink tool drops the ink selection.
  useEffect(() => {
    if (!selecting || !capturing) {
      setPicked((p) => (p.size ? new Set() : p))
      setLasso(null)
      setPreview(null)
    }
  }, [selecting, capturing])

  // Delete / Backspace remove the selected strokes (before the canvas's own Delete shortcut).
  useEffect(() => {
    if (!selecting || !capturing || selection.size === 0) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      const t = e.target as HTMLElement | null
      if (t && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
      const { strokes: current, selection: sel, onStrokesChange: change } = latest.current
      if (sel.size === 0) return
      e.preventDefault()
      e.stopPropagation()
      change(deleteStrokes(current, sel), 'erase')
      setPicked(new Set())
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [selecting, capturing, selection])

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
    const prior = gesture.current
    if (prior) {
      // A palm that touched down first gives way to the pen: its gesture is dropped, unsaved.
      if (ev.pointerType !== 'pen' || prior.pointerType !== 'touch') return
      gesture.current = null
      setLive(null)
      setLasso(null)
      setPreview(null)
      try {
        e.currentTarget.releasePointerCapture?.(prior.pointerId)
      } catch {
        /* not captured */
      }
    }
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
    const points = samplesFrom(ev, toFlow)
    let mode: Gesture['mode'] = eraserEnd || t.tool === 'eraser' ? 'erase' : 'draw'
    let corner: Corner | undefined
    if (!eraserEnd && t.tool === 'select') {
      const { strokes: current, zoom: z, selection: sel, box: b } = latest.current
      const [x, y] = points[0]
      const r = INK_HANDLE_PX / (z || 1)
      corner = b ? (handleAt(b, x, y, r) ?? undefined) : undefined
      if (corner) mode = 'scale'
      else if (b && x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY) mode = 'move'
      else {
        const id = strokeAt(current, x, y, ERASER_RADIUS_PX / (z || 1))
        if (id) {
          const next = ev.shiftKey ? new Set([...sel, id]) : sel.has(id) ? sel : new Set([id])
          setPicked(next)
          latest.current.selection = next
          latest.current.box = selectionBounds(current, next)
          mode = 'move'
        } else {
          if (!ev.shiftKey) setPicked(new Set())
          mode = 'lasso'
        }
      }
    }
    const drawTool: InkStrokeTool = t.tool === 'highlighter' ? 'highlighter' : 'pen'
    const g: Gesture = {
      pointerId: ev.pointerId,
      pointerType: ev.pointerType,
      mode,
      partial: mode === 'erase' && t.eraseMode === 'partial',
      corner,
      start: { x: points[0][0], y: points[0][1] },
      tool: drawTool,
      color: t.color,
      width: t.width,
      points,
    }
    gesture.current = g
    if (mode === 'lasso') setLasso(points)
    if (mode === 'draw') setLive({ tool: g.tool, color: g.color, width: g.width, pointerType: g.pointerType, points: g.points })
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current
    const ev = e.nativeEvent
    if (!g || ev.pointerId !== g.pointerId) return
    g.points = g.points.concat(samplesFrom(ev, toFlow))
    if (g.mode === 'draw') setLive({ tool: g.tool, color: g.color, width: g.width, pointerType: g.pointerType, points: g.points })
    else if (g.mode === 'lasso') setLasso(g.points)
    else if (g.mode === 'move' || g.mode === 'scale') setPreview(selectionTransform(g))
  }

  /** The SVG transform previewing a move or scale gesture on the selected strokes. */
  const selectionTransform = (g: Gesture): string | null => {
    const last = g.points[g.points.length - 1]
    const b = latest.current.box
    if (!last || !g.start || !b) return null
    if (g.mode === 'move') return `translate(${last[0] - g.start.x} ${last[1] - g.start.y})`
    if (g.mode === 'scale' && g.corner) {
      const [ax, ay] = oppositeCorner(b, g.corner)
      const k = cornerScale(b, g.corner, last[0], last[1])
      return `translate(${ax} ${ay}) scale(${k}) translate(${-ax} ${-ay})`
    }
    return null
  }

  const end = (e: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const ev = e.nativeEvent
    if (ev.pointerType === 'pen') pensDown.current.delete(ev.pointerId)
    const g = gesture.current
    if (!g || ev.pointerId !== g.pointerId) return
    gesture.current = null
    setLive(null)
    setLasso(null)
    setPreview(null)
    try {
      e.currentTarget.releasePointerCapture?.(ev.pointerId)
    } catch {
      /* not captured */
    }
    if (cancelled || g.points.length === 0) return
    const { strokes: current, zoom: z, onStrokesChange: change } = latest.current
    if (g.mode === 'draw') {
      // A path over the file's per-stroke limit is kept as several strokes (one would fail every save).
      const drawn = splitPoints(g.points).map((pts) => finishStroke(newStrokeId(), g.tool, g.color, g.width, pts, g.pointerType))
      change([...current, ...drawn], 'draw')
      return
    }
    const { selection: sel, box: b } = latest.current
    const last = g.points[g.points.length - 1]
    if (g.mode === 'lasso') {
      const enclosed = lassoSelect(current, g.points)
      setPicked(ev.shiftKey ? new Set([...sel, ...enclosed]) : enclosed)
      return
    }
    if (g.mode === 'move') {
      const dx = last[0] - (g.start?.x ?? last[0])
      const dy = last[1] - (g.start?.y ?? last[1])
      if ((dx !== 0 || dy !== 0) && sel.size > 0) change(translateStrokes(current, sel, dx, dy), 'draw')
      return
    }
    if (g.mode === 'scale') {
      if (!b || !g.corner || sel.size === 0) return
      const [ax, ay] = oppositeCorner(b, g.corner)
      const k = cornerScale(b, g.corner, last[0], last[1])
      if (k !== 1) change(scaleStrokes(current, sel, ax, ay, k), 'draw')
      return
    }
    const radius = ERASER_RADIUS_PX / (z || 1)
    if (g.partial) {
      const cut = erasePartially(current, g.points, radius)
      if (cut.changed) change(cut.strokes, 'erase')
      return
    }
    const hit = hitStrokes(current, g.points, radius)
    if (hit.size > 0) change(current.filter((s) => !hit.has(s.id)), 'erase')
  }

  const handleSize = INK_HANDLE_PX / (zoom || 1)

  return (
    <>
      <ViewportPortal>
        <svg data-ink-layer="" style={SVG_STYLE} aria-hidden>
          {strokes.map((s) =>
            preview && selection.has(s.id) ? null : <StrokePath key={s.id} stroke={s} />,
          )}
          {preview && (
            <g data-ink-preview="" transform={preview}>
              {strokes
                .filter((s) => selection.has(s.id))
                .map((s) => (
                  <StrokePath key={s.id} stroke={s} />
                ))}
            </g>
          )}
          {live && <LivePath live={live} />}
          {lasso && lasso.length > 1 && (
            <polygon
              data-ink-lasso=""
              points={lasso.map(([x, y]) => `${x},${y}`).join(' ')}
              fill="var(--color-bg-block-selection)"
              stroke="var(--color-border-block-selection)"
              strokeWidth={1 / (zoom || 1)}
              strokeDasharray={`${4 / (zoom || 1)} ${4 / (zoom || 1)}`}
            />
          )}
          {box && !preview && (
            <g data-ink-selection="">
              <rect
                x={box.minX}
                y={box.minY}
                width={box.maxX - box.minX}
                height={box.maxY - box.minY}
                fill="none"
                stroke="var(--color-border-block-selection)"
                strokeWidth={1 / (zoom || 1)}
              />
              {Object.entries(corners(box)).map(([c, [x, y]]) => (
                <rect
                  key={c}
                  data-ink-handle={c}
                  x={x - handleSize / 2}
                  y={y - handleSize / 2}
                  width={handleSize}
                  height={handleSize}
                  fill="var(--color-bg-front)"
                  stroke="var(--color-border-block-selection)"
                  strokeWidth={1 / (zoom || 1)}
                />
              ))}
            </g>
          )}
        </svg>
      </ViewportPortal>
      {capturing && (
        <div
          ref={overlay}
          data-ink-capture=""
          data-ink-tool={tool.tool}
          className="nopan nodrag nowheel"
          style={{ position: 'absolute', inset: 0, zIndex: 4, touchAction: 'none', cursor: selecting ? 'default' : 'crosshair' }}
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
