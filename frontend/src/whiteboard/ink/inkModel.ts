// colour-literals: content palette
import { getStroke, type StrokeOptions } from 'perfect-freehand'
import { THEME_COLORS, type ThemeColor } from '@/theme/palette'
import type { InkStroke, InkStrokeTool, InkToolState } from './types'

/** Pen widths in canvas units; default 4. */
export const PEN_WIDTHS = [2, 4, 8] as const
/** Highlighter widths; default 16. */
export const HIGHLIGHTER_WIDTHS = [16, 32] as const
/** Highlighter strokes are drawn (and stored) at this fill opacity. */
export const HIGHLIGHTER_OPACITY = 0.35
/** The eraser removes strokes passing within this many screen pixels of its path. */
export const ERASER_RADIUS_PX = 10

/**
 * The hex behind each theme colour's `--line-<name>` token (`theme/tokens.css`). `lineColor()`
 * returns the CSS variable, which an SVG file can't use, so the values are copied here; a test
 * checks them against the stylesheet.
 */
const LINE_HEX: Record<ThemeColor, string> = {
  gray: '#5c5959',
  rose: '#ea4561',
  pink: '#e34d97',
  fuchsia: '#d14be5',
  purple: '#a558ee',
  violet: '#8a5fed',
  indigo: '#6568e8',
  blue: '#3f80eb',
  sky: '#199dd9',
  cyan: '#11a9c3',
  teal: '#1dad9d',
  emerald: '#19ae7d',
  green: '#2bbb60',
  lime: '#7fbe1f',
  yellow: '#daaa14',
  amber: '#e89a17',
  orange: '#ec731f',
  red: '#e54a4a',
}

/** The 18 theme colours in menu order, each with its line hex. */
export const INK_COLORS: readonly { name: ThemeColor; hex: string }[] = THEME_COLORS.map((name) => ({
  name,
  hex: LINE_HEX[name],
}))

export const DEFAULT_INK: InkToolState = { tool: 'pen', color: LINE_HEX.gray, width: 4 }

/** The theme colour name for a stored hex, if it is one of ours. */
export function inkColorName(hex: string): ThemeColor | undefined {
  const h = hex.toLowerCase()
  return INK_COLORS.find((c) => c.hex === h)?.name
}

/** `perfect-freehand` options for a stroke. Mouse and touch simulate pressure; pens report it. */
export function strokeOptions(tool: InkStrokeTool, width: number, pointerType: string, last = false): StrokeOptions {
  return {
    size: width,
    thinning: tool === 'highlighter' ? 0 : 0.5,
    smoothing: 0.5,
    streamline: 0.5,
    simulatePressure: pointerType !== 'pen',
    last,
  }
}

type Point = { x: number; y: number }

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0.5
  return Math.min(1, Math.max(0, n))
}

/**
 * The samples of one pointer event in flow coordinates: every coalesced event when the browser
 * provides them (so fast strokes have no gaps). Pressure is the pen's; anything else records 0.5.
 */
export function samplesFrom(e: PointerEvent, toFlow: (p: Point) => Point): [number, number, number][] {
  let events: PointerEvent[] = []
  if (typeof e.getCoalescedEvents === 'function') {
    try {
      events = e.getCoalescedEvents()
    } catch {
      events = []
    }
  }
  if (events.length === 0) events = [e]
  const pen = e.pointerType === 'pen'
  return events.map((ev) => {
    const p = toFlow({ x: ev.clientX, y: ev.clientY })
    return [p.x, p.y, pen ? clamp01(ev.pressure) : 0.5]
  })
}

/** The Wacom eraser end: `buttons & 32`, or a pen reporting button 5. */
export function isEraserEnd(e: Pick<PointerEvent, 'buttons' | 'button' | 'pointerType'>): boolean {
  return (e.buttons & 32) !== 0 || (e.pointerType === 'pen' && e.button === 5)
}

/** The pen's barrel button (`buttons & 2`) never draws. */
export function isBarrelButton(e: Pick<PointerEvent, 'buttons'>): boolean {
  return (e.buttons & 2) !== 0
}

/** The outline polygon of a stroke. */
export function outlineFor(points: readonly (readonly number[])[], opts: StrokeOptions): number[][] {
  if (points.length === 0) return []
  return getStroke(points.map((p) => [...p]), opts)
}

function num(n: number): string {
  const s = (Math.round(n * 100) / 100).toFixed(2).replace(/\.?0+$/, '')
  return s === '-0' || s === '' ? '0' : s
}

/**
 * The outline as an SVG path: quadratic curves through the midpoints, 2 decimals, using only
 * `M`, `Q`, `Z`, digits, `.`, `-` and spaces (the server's `d` rule).
 */
export function svgPathFromOutline(outline: readonly (readonly number[])[]): string {
  const n = outline.length
  if (n === 0) return ''
  const parts: string[] = ['M', num(outline[0][0]), num(outline[0][1]), 'Q']
  for (let i = 0; i < n; i++) {
    const [x0, y0] = outline[i]
    const [x1, y1] = outline[(i + 1) % n]
    parts.push(num(x0), num(y0), num((x0 + x1) / 2), num((y0 + y1) / 2))
  }
  parts.push('Z')
  return parts.join(' ')
}

function round(n: number, places: number): number {
  const f = 10 ** places
  const r = Math.round(n * f) / f
  return Object.is(r, -0) ? 0 : r
}

/** A finished stroke: points rounded as the file stores them, outline computed with `last`. */
export function finishStroke(
  id: string,
  tool: InkStrokeTool,
  color: string,
  width: number,
  points: readonly (readonly number[])[],
  pointerType: string,
): InkStroke {
  const pts = points.map((p) => [round(p[0], 2), round(p[1], 2), round(clamp01(p[2] ?? 0.5), 3)] as [number, number, number])
  const d = svgPathFromOutline(outlineFor(pts, strokeOptions(tool, width, pointerType, true)))
  const stroke: InkStroke = { id, tool, color, width, points: pts, d }
  const name = inkColorName(color)
  if (name) stroke.colorName = name
  return stroke
}

export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** The bounds of a stroke's points. */
export function strokeBounds(stroke: Pick<InkStroke, 'points'>): Bounds {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [x, y] of stroke.points) {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  return { minX, minY, maxX, maxY }
}

function pointSegDist2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  const cx = ax + t * dx - px
  const cy = ay + t * dy - py
  return cx * cx + cy * cy
}

function cross(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
}

function segmentsIntersect(a: readonly number[], b: readonly number[], c: readonly number[], d: readonly number[]): boolean {
  const d1 = cross(c[0], c[1], d[0], d[1], a[0], a[1])
  const d2 = cross(c[0], c[1], d[0], d[1], b[0], b[1])
  const d3 = cross(a[0], a[1], b[0], b[1], c[0], c[1])
  const d4 = cross(a[0], a[1], b[0], b[1], d[0], d[1])
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
}

/** The squared distance between segments ab and cd. */
function segSegDist2(a: readonly number[], b: readonly number[], c: readonly number[], d: readonly number[]): number {
  if (segmentsIntersect(a, b, c, d)) return 0
  return Math.min(
    pointSegDist2(a[0], a[1], c[0], c[1], d[0], d[1]),
    pointSegDist2(b[0], b[1], c[0], c[1], d[0], d[1]),
    pointSegDist2(c[0], c[1], a[0], a[1], b[0], b[1]),
    pointSegDist2(d[0], d[1], a[0], a[1], b[0], b[1]),
  )
}

function segments(points: readonly (readonly number[])[]): [readonly number[], readonly number[]][] {
  if (points.length === 1) return [[points[0], points[0]]]
  const out: [readonly number[], readonly number[]][] = []
  for (let i = 0; i + 1 < points.length; i++) out.push([points[i], points[i + 1]])
  return out
}

/**
 * The ids of every stroke whose points pass within `radiusFlow` (canvas units; the screen radius
 * divided by the zoom) of the eraser path. Whole strokes only.
 */
export function hitStrokes(
  strokes: readonly InkStroke[],
  eraserPath: readonly (readonly number[])[],
  radiusFlow: number,
): Set<string> {
  const hit = new Set<string>()
  if (eraserPath.length === 0) return hit
  const eb = strokeBounds({ points: eraserPath as [number, number, number][] })
  const r2 = radiusFlow * radiusFlow
  const eraserSegs = segments(eraserPath)
  for (const s of strokes) {
    if (s.points.length === 0) continue
    const b = strokeBounds(s)
    if (b.minX - radiusFlow > eb.maxX || b.maxX + radiusFlow < eb.minX) continue
    if (b.minY - radiusFlow > eb.maxY || b.maxY + radiusFlow < eb.minY) continue
    const strokeSegs = segments(s.points)
    outer: for (const [a, bb] of strokeSegs) {
      for (const [c, d] of eraserSegs) {
        if (segSegDist2(a, bb, c, d) <= r2) {
          hit.add(s.id)
          break outer
        }
      }
    }
  }
  return hit
}

/**
 * Apply what changed locally since `base` (strokes added and removed, by id) to `remote`.
 * Strokes never change in place, so additions and removals are the whole story.
 */
export function mergeStrokes(
  base: readonly InkStroke[],
  local: readonly InkStroke[],
  remote: readonly InkStroke[],
): InkStroke[] {
  const baseIds = new Set(base.map((s) => s.id))
  const localIds = new Set(local.map((s) => s.id))
  const removed = new Set([...baseIds].filter((id) => !localIds.has(id)))
  const out = remote.filter((s) => !removed.has(s.id))
  const have = new Set(out.map((s) => s.id))
  for (const s of local) {
    if (!baseIds.has(s.id) && !have.has(s.id)) {
      out.push(s)
      have.add(s.id)
    }
  }
  return out
}

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** A ULID-like id: 10 characters of time, 16 of randomness (Crockford base 32). */
export function newStrokeId(now: number = Date.now()): string {
  let t = Math.max(0, Math.floor(now))
  let time = ''
  for (let i = 0; i < 10; i++) {
    time = ALPHABET[t % 32] + time
    t = Math.floor(t / 32)
  }
  const bytes = new Uint8Array(16)
  const c = globalThis.crypto as Crypto | undefined
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes)
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256)
  let rand = ''
  for (const b of bytes) rand += ALPHABET[b % 32]
  return time + rand
}
