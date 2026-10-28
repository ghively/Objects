/**
 * Connector geometry and stroke, from Capacities' `whiteboard.model.ts` rules: an unset
 * `connection` is cornered (Vue Flow smoothstep, React Flow's `getSmoothStepPath`), `curved` is
 * the bezier and `straight` a line; an unset `line` is solid, dashed is `8 8` and dotted `0 10`,
 * both with round caps; `arrowClosed` renders as `arrow`. The stroke width is the reference CSS
 * `.whiteboard-canvas .vue-flow__edge-path { stroke-width: 3px }`.
 */
import type { CSSProperties } from 'react'
import { Position, getBezierPath, getSmoothStepPath, getStraightPath } from '@xyflow/react'
import type {
  WhiteboardData,
  WhiteboardEdge,
  WhiteboardEdgeConnection,
  WhiteboardPickerMarker,
  WhiteboardTextBlock,
  WhiteboardThemeColor,
} from '@/api/whiteboardTypes'
import { COLOR_VALUES, borderValue, isDarkMode } from '../colors'
import * as A from '../actions'
import type { MarkerDefsProps } from '../canvasTypes'
import { dasharray, normalizeConnection, normalizeMarker } from '../model'

/** Reference CSS: `.whiteboard-canvas .vue-flow__edge-path { stroke-width: 3px }`. */
export const EDGE_STROKE_WIDTH = 3
/** Reference CSS: `.whiteboard-canvas .vue-flow__edge { color: var(--whiteboard-edge-color, var(--color-border-front-strong)) }`. */
export const DEFAULT_EDGE_COLOR = 'var(--color-border-front-strong)'
/** Reference CSS: `.whiteboard-canvas .vue-flow__edge.selected { color: var(--color-border-block-selection) }`. */
export const SELECTED_EDGE_COLOR = 'var(--color-border-block-selection)'
/** Width of the invisible hit stroke around a connector (our choice). */
export const EDGE_HIT_WIDTH = 20

export interface EdgeGeometry {
  sourceX: number
  sourceY: number
  targetX: number
  targetY: number
  sourcePosition?: Position
  targetPosition?: Position
}

export interface EdgePath {
  path: string
  labelX: number
  labelY: number
}

/** The SVG path of a connector (straight / smoothstep / bezier; unset → smoothstep) and its midpoint. */
export function pathFor(connection: WhiteboardEdgeConnection | undefined, g: EdgeGeometry): EdgePath {
  const sourcePosition = g.sourcePosition ?? Position.Right
  const targetPosition = g.targetPosition ?? Position.Left
  const base = { sourceX: g.sourceX, sourceY: g.sourceY, targetX: g.targetX, targetY: g.targetY }
  const kind = normalizeConnection(connection)
  if (kind === 'straight') {
    const [path, labelX, labelY] = getStraightPath(base)
    return { path, labelX, labelY }
  }
  if (kind === 'curved') {
    const [path, labelX, labelY] = getBezierPath({ ...base, sourcePosition, targetPosition })
    return { path, labelX, labelY }
  }
  const [path, labelX, labelY] = getSmoothStepPath({ ...base, sourcePosition, targetPosition })
  return { path, labelX, labelY }
}

/** Which colour key a connector's markers use: its theme colour, `default`, or `selected`. */
export type MarkerColorKey = WhiteboardThemeColor | 'default' | 'selected'

function themeOf(color: string | undefined): WhiteboardThemeColor | null {
  return color && Object.prototype.hasOwnProperty.call(COLOR_VALUES, color) ? (color as WhiteboardThemeColor) : null
}

export function markerColorKey(edge: Pick<WhiteboardEdge, 'color'>, selected = false): MarkerColorKey {
  if (selected) return 'selected'
  return themeOf(edge.color) ?? 'default'
}

/** The paint behind a colour key (the theme's border value, or the reference CSS variables). */
export function colorForKey(key: MarkerColorKey, dark = isDarkMode()): string {
  if (key === 'selected') return SELECTED_EDGE_COLOR
  if (key === 'default') return DEFAULT_EDGE_COLOR
  return borderValue(key, dark) ?? DEFAULT_EDGE_COLOR
}

/** A connector's stroke colour: its theme colour, else the default edge colour; the selection colour when selected. */
export function edgeColor(edge: Pick<WhiteboardEdge, 'color'>, selected = false, dark = isDarkMode()): string {
  return colorForKey(markerColorKey(edge, selected), dark)
}

/** The visible path's style: colour, width 3, round caps and joins, and the dash array of its line. */
export function strokeFor(
  edge: Pick<WhiteboardEdge, 'color' | 'line'>,
  opts: { selected?: boolean; dark?: boolean } = {},
): CSSProperties {
  const style: CSSProperties = {
    stroke: edgeColor(edge, opts.selected ?? false, opts.dark ?? isDarkMode()),
    strokeWidth: EDGE_STROKE_WIDTH,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    fill: 'none',
  }
  const dash = dasharray(edge.line)
  if (dash) style.strokeDasharray = dash
  return style
}

/** The tip kinds a marker definition exists for. */
export type TipKind = Exclude<WhiteboardPickerMarker, 'none'>

/** The id of the `<marker>` for one tip kind in one colour (`orient="auto-start-reverse"` serves both ends). */
export function markerId(kind: TipKind, color: MarkerColorKey): string {
  return `wb-tip-${kind}-${color}`
}

/** The marker ids of a connector's start and end tips (`arrowClosed` → arrow; none → undefined). */
export function markerIds(
  edge: Pick<WhiteboardEdge, 'markerStart' | 'markerEnd' | 'color'>,
  selected = false,
): { start?: string; end?: string } {
  const color = markerColorKey(edge, selected)
  const start = normalizeMarker(edge.markerStart)
  const end = normalizeMarker(edge.markerEnd)
  return {
    ...(start !== 'none' ? { start: markerId(start, color) } : {}),
    ...(end !== 'none' ? { end: markerId(end, color) } : {}),
  }
}

/** The text of a connector's label: its text block's Markdown, else the deprecated `label` string. */
export function labelText(edge: Pick<WhiteboardEdge, 'label'>, block: { type: string; markdown?: string } | undefined): string | null {
  if (block && block.type === 'text' && typeof block.markdown === 'string') return block.markdown
  if (typeof edge.label === 'string') return edge.label
  return null
}

/** The board after committing `text` as the label of `edgeId` (empty text removes the label). */
export function commitEdgeLabel(board: WhiteboardData, edgeId: string, text: string): WhiteboardData {
  const edge = board.edges[edgeId]
  if (!edge) return board
  if (text.trim() === '') return A.removeEdgeLabel(board, edgeId)
  const prev = edge.blockId !== undefined ? board.blocks[edge.blockId] : undefined
  const block: WhiteboardTextBlock =
    prev && prev.type === 'text' ? { ...prev, markdown: text } : { type: 'text', markdown: text }
  if (prev && prev.type === 'text' && prev.markdown === text && !('label' in edge)) return board
  return A.setBlock(board, edgeId, block)
}

interface TipShape {
  viewBox: string
  width: number
  height: number
  refX: number
  refY: number
  d: string
}

/** Tip drawings in user space (independent of the 3 px stroke width). */
export const TIP_SHAPES: Record<TipKind, TipShape> = {
  arrow: { viewBox: '0 0 12 12', width: 12, height: 12, refX: 10, refY: 6, d: 'M0,1 L12,6 L0,11 Z' },
  dot: {
    viewBox: '0 0 12 12',
    width: 10,
    height: 10,
    refX: 6,
    refY: 6,
    d: 'M1.5,6 A4.5,4.5 0 1,0 10.5,6 A4.5,4.5 0 1,0 1.5,6 Z',
  },
  double: { viewBox: '0 0 18 12', width: 18, height: 12, refX: 16, refY: 6, d: 'M0,1 L10,6 L0,11 Z M7,1 L18,6 L7,11 Z' },
}

/** Every (tip kind, colour) pair the connectors need, in a stable order. */
export function markersInUse(edges: MarkerDefsProps['edges']): { kind: TipKind; color: MarkerColorKey }[] {
  const seen = new Set<string>()
  const out: { kind: TipKind; color: MarkerColorKey }[] = []
  const add = (kind: TipKind, color: MarkerColorKey) => {
    const id = markerId(kind, color)
    if (seen.has(id)) return
    seen.add(id)
    out.push({ kind, color })
  }
  for (const e of edges) {
    for (const m of [e.markerStart, e.markerEnd]) {
      const kind = normalizeMarker(m)
      if (kind === 'none') continue
      add(kind, markerColorKey(e))
      add(kind, 'selected')
    }
  }
  return out
}
