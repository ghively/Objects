import { finishStroke, hitStrokes, strokeBounds, strokePointerType, type Bounds } from './inkModel'
import type { InkStroke } from './types'

/** Corner handles of the ink selection box, in screen pixels (half the hit square). */
export const INK_HANDLE_PX = 8
/** The smallest scale a corner drag may reach (our choice), so a selection never collapses. */
export const MIN_INK_SCALE = 0.05

export type Corner = 'nw' | 'ne' | 'sw' | 'se'

type Pt = readonly number[]

/** Point-in-polygon (even-odd rule). */
export function pointInPolygon(x: number, y: number, polygon: readonly Pt[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]
    const [xj, yj] = polygon[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/**
 * The strokes a lasso encloses: every point of the stroke inside the closed lasso polygon (our
 * choice: fully enclosed, so a lasso never grabs a long stroke it only touches).
 */
export function lassoSelect(strokes: readonly InkStroke[], lasso: readonly Pt[]): Set<string> {
  const out = new Set<string>()
  if (lasso.length < 3) return out
  for (const s of strokes) {
    if (s.points.length === 0) continue
    if (s.points.every(([x, y]) => pointInPolygon(x, y, lasso))) out.add(s.id)
  }
  return out
}

/** The topmost stroke within `radiusFlow` of a click, or null. */
export function strokeAt(strokes: readonly InkStroke[], x: number, y: number, radiusFlow: number): string | null {
  for (let i = strokes.length - 1; i >= 0; i--) {
    const s = strokes[i]
    const r = radiusFlow + s.width / 2
    if (hitStrokes([s], [[x, y, 0.5]], r).size > 0) return s.id
  }
  return null
}

/** The bounds of the selected strokes (their points padded by half the stroke width), or null. */
export function selectionBounds(strokes: readonly InkStroke[], ids: ReadonlySet<string>): Bounds | null {
  let b: Bounds | null = null
  for (const s of strokes) {
    if (!ids.has(s.id) || s.points.length === 0) continue
    const sb = strokeBounds(s)
    const pad = s.width / 2
    const p = { minX: sb.minX - pad, minY: sb.minY - pad, maxX: sb.maxX + pad, maxY: sb.maxY + pad }
    b = b
      ? { minX: Math.min(b.minX, p.minX), minY: Math.min(b.minY, p.minY), maxX: Math.max(b.maxX, p.maxX), maxY: Math.max(b.maxY, p.maxY) }
      : p
  }
  return b
}

/** The four corners of a box. */
export function corners(b: Bounds): Record<Corner, [number, number]> {
  return { nw: [b.minX, b.minY], ne: [b.maxX, b.minY], sw: [b.minX, b.maxY], se: [b.maxX, b.maxY] }
}

/** The corner opposite another: the fixed anchor of a corner drag. */
export function oppositeCorner(b: Bounds, c: Corner): [number, number] {
  const o: Record<Corner, Corner> = { nw: 'se', ne: 'sw', sw: 'ne', se: 'nw' }
  return corners(b)[o[c]]
}

/** The corner handle under a point, if any (`radiusFlow` = the handle size divided by the zoom). */
export function handleAt(b: Bounds, x: number, y: number, radiusFlow: number): Corner | null {
  for (const [c, [cx, cy]] of Object.entries(corners(b)) as [Corner, [number, number]][]) {
    if (Math.abs(x - cx) <= radiusFlow && Math.abs(y - cy) <= radiusFlow) return c
  }
  return null
}

/**
 * The uniform scale a corner drag gives (our choice: corner handles keep the selection's
 * proportions): the larger of the horizontal and vertical ratios, at least `MIN_INK_SCALE`.
 */
export function cornerScale(b: Bounds, c: Corner, x: number, y: number): number {
  const [ax, ay] = oppositeCorner(b, c)
  const [cx, cy] = corners(b)[c]
  const ratios: number[] = []
  if (Math.abs(cx - ax) > 1e-6) ratios.push((x - ax) / (cx - ax))
  if (Math.abs(cy - ay) > 1e-6) ratios.push((y - ay) / (cy - ay))
  if (ratios.length === 0) return 1
  return Math.max(MIN_INK_SCALE, Math.max(...ratios))
}

function round2(n: number): number {
  const r = Math.round(n * 100) / 100
  return Object.is(r, -0) ? 0 : r
}

/**
 * The `d` of an outline we wrote (`M x y Q x y x y … Z`), every coordinate pair moved by dx, dy:
 * the stroke looks exactly as before. Null for a path in any other shape.
 */
export function translatePath(d: string, dx: number, dy: number): string | null {
  const tokens = d.trim().split(/\s+/)
  const out: string[] = []
  let axis = 0
  for (const t of tokens) {
    if (t === 'M' || t === 'Q' || t === 'Z') {
      out.push(t)
      continue
    }
    const n = Number(t)
    if (t === '' || !Number.isFinite(n)) return null
    const v = round2(n + (axis === 0 ? dx : dy))
    out.push(String(v))
    axis = 1 - axis
  }
  return axis === 0 ? out.join(' ') : null
}

/**
 * The strokes with the selected ones moved by dx, dy (points shifted, `d` moved with them). Every
 * other stroke is returned as the same object, so only the moved strokes change.
 */
export function translateStrokes(strokes: readonly InkStroke[], ids: ReadonlySet<string>, dx: number, dy: number): InkStroke[] {
  if (dx === 0 && dy === 0) return [...strokes]
  return strokes.map((s) => {
    if (!ids.has(s.id)) return s
    const points = s.points.map(([x, y, p]) => [round2(x + dx), round2(y + dy), p] as [number, number, number])
    const d = translatePath(s.d, dx, dy)
    if (d === null) return { ...finishStroke(s.id, s.tool, s.color, s.width, points, strokePointerType(s)), ...keepName(s) }
    return { ...s, points, d }
  })
}

function keepName(s: InkStroke): Partial<InkStroke> {
  return s.colorName ? { colorName: s.colorName } : {}
}

/**
 * The strokes with the selected ones scaled by `scale` about (ax, ay): points transformed, width
 * scaled (within the file's 0.5 to 200) and `d` recomputed. Other strokes are the same objects.
 */
export function scaleStrokes(
  strokes: readonly InkStroke[],
  ids: ReadonlySet<string>,
  ax: number,
  ay: number,
  scale: number,
): InkStroke[] {
  if (scale === 1) return [...strokes]
  return strokes.map((s) => {
    if (!ids.has(s.id)) return s
    const points = s.points.map(([x, y, p]) => [ax + (x - ax) * scale, ay + (y - ay) * scale, p] as [number, number, number])
    const width = Math.min(200, Math.max(0.5, round2(s.width * scale)))
    return { ...finishStroke(s.id, s.tool, s.color, width, points, strokePointerType(s)), ...keepName(s) }
  })
}

/** The strokes without the selected ones. */
export function deleteStrokes(strokes: readonly InkStroke[], ids: ReadonlySet<string>): InkStroke[] {
  return strokes.filter((s) => !ids.has(s.id))
}
