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

type TiltFields = { tiltX?: number; tiltY?: number; altitudeAngle?: number }

/**
 * The pen's altitude in radians (pi/2 upright, 0 flat): `altitudeAngle` when the browser reports
 * it, else derived from `tiltX`/`tiltY` (degrees); upright when neither is known.
 */
export function penAltitude(e: TiltFields): number {
  const alt = e.altitudeAngle
  if (typeof alt === 'number' && Number.isFinite(alt)) return Math.min(Math.PI / 2, Math.max(0, alt))
  const tx = typeof e.tiltX === 'number' && Number.isFinite(e.tiltX) ? e.tiltX : 0
  const ty = typeof e.tiltY === 'number' && Number.isFinite(e.tiltY) ? e.tiltY : 0
  if (tx === 0 && ty === 0) return Math.PI / 2
  if (Math.abs(tx) >= 90 || Math.abs(ty) >= 90) return 0
  const r = Math.PI / 180
  const t = Math.hypot(Math.tan(tx * r), Math.tan(ty * r))
  return Math.atan2(1, t)
}

/**
 * Pen tilt scales the recorded pressure (our choice): `0.6 + 0.4 * sin(altitude)`, so an upright
 * pen keeps its pressure and a pen laid flat writes at 60% of it. No file format change.
 */
export function tiltFactor(e: TiltFields): number {
  return 0.6 + 0.4 * Math.sin(penAltitude(e))
}

/**
 * The samples of one pointer event in flow coordinates: every coalesced event when the browser
 * provides them (so fast strokes have no gaps). Pressure is the pen's, scaled by its tilt
 * (`tiltFactor`); anything else records 0.5 (mouse and touch have no tilt effect).
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
    if (!pen) return [p.x, p.y, 0.5]
    const tilt: TiltFields = {
      tiltX: (ev as TiltFields).tiltX ?? (e as TiltFields).tiltX,
      tiltY: (ev as TiltFields).tiltY ?? (e as TiltFields).tiltY,
      altitudeAngle: (ev as TiltFields).altitudeAngle ?? (e as TiltFields).altitudeAngle,
    }
    return [p.x, p.y, clamp01(clamp01(ev.pressure) * tiltFactor(tilt))]
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

/** The file's point limit per stroke (`whiteboardink.MAX_POINTS`); one save over it fails. */
export const MAX_STROKE_POINTS = 20_000
/**
 * A path is cut into strokes of at most this many points while it is drawn. The file also caps a
 * stroke's `d` at 1 MB (`whiteboardink.MAX_D_BYTES`), which a 20,000-point pen stroke exceeds
 * (1.33 MB; it would fail every later save): 10,000 points stay under 0.7 MB.
 */
export const SPLIT_STROKE_POINTS = 10_000

/**
 * A drawn path cut into pieces of at most `max` points, each starting at the previous piece's
 * last point so the line stays unbroken.
 */
export function splitPoints<T>(points: readonly T[], max = SPLIT_STROKE_POINTS): T[][] {
  if (points.length <= max) return [points.slice()]
  const out: T[][] = []
  for (let start = 0; start < points.length - 1; start += max - 1) out.push(points.slice(start, start + max))
  return out
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

export function pointSegDist2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
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
export function segSegDist2(a: readonly number[], b: readonly number[], c: readonly number[], d: readonly number[]): number {
  if (segmentsIntersect(a, b, c, d)) return 0
  return Math.min(
    pointSegDist2(a[0], a[1], c[0], c[1], d[0], d[1]),
    pointSegDist2(b[0], b[1], c[0], c[1], d[0], d[1]),
    pointSegDist2(c[0], c[1], a[0], a[1], b[0], b[1]),
    pointSegDist2(d[0], d[1], a[0], a[1], b[0], b[1]),
  )
}

export function segments(points: readonly (readonly number[])[]): [readonly number[], readonly number[]][] {
  if (points.length === 1) return [[points[0], points[0]]]
  const out: [readonly number[], readonly number[]][] = []
  for (let i = 0; i + 1 < points.length; i++) out.push([points[i], points[i + 1]])
  return out
}

/**
 * The eraser path on a coarse grid (cells four radii wide over the path's bounds; each segment,
 * grown by the radius, is filed in every cell it covers), so a stroke's segments and points are
 * tested against the few eraser segments near them instead of all of them. The plain double loop
 * took 1.4 s for 2,000 strokes of 100 points against a 150-point eraser path, freezing the canvas.
 */
export class EraserIndex {
  /** The path's bounds grown by the radius: a stroke outside them can't be hit. */
  readonly bounds: Bounds
  private readonly r2: number
  private readonly cell: number
  private readonly cols: number
  private readonly rows: number
  private readonly segs: [readonly number[], readonly number[]][]
  /** Per segment, its bounds grown by the radius (minX, minY, maxX, maxY). */
  private readonly segBounds: Float64Array
  /** Per cell (column-major), the segments filed in it. */
  private readonly cells: (number[] | undefined)[]
  /** Per segment, the id of the last query that tested it (each is tested once per query). */
  private readonly seen: Int32Array
  private query = 0

  constructor(eraserPath: readonly (readonly number[])[], radiusFlow: number) {
    const r = Math.max(radiusFlow, 0)
    this.r2 = r * r
    this.cell = Math.max(4 * r, 1)
    const b = strokeBounds({ points: eraserPath as [number, number, number][] })
    this.bounds = { minX: b.minX - r, minY: b.minY - r, maxX: b.maxX + r, maxY: b.maxY + r }
    this.cols = eraserPath.length ? Math.floor((this.bounds.maxX - this.bounds.minX) / this.cell) + 1 : 0
    this.rows = eraserPath.length ? Math.floor((this.bounds.maxY - this.bounds.minY) / this.cell) + 1 : 0
    this.cells = new Array<number[] | undefined>(this.cols * this.rows)
    this.segs = eraserPath.length ? segments(eraserPath) : []
    this.segBounds = new Float64Array(this.segs.length * 4)
    this.seen = new Int32Array(this.segs.length)
    this.segs.forEach(([c, d], i) => {
      const minX = Math.min(c[0], d[0]) - r
      const minY = Math.min(c[1], d[1]) - r
      const maxX = Math.max(c[0], d[0]) + r
      const maxY = Math.max(c[1], d[1]) + r
      this.segBounds.set([minX, minY, maxX, maxY], i * 4)
      const x0 = this.col(minX)
      const x1 = this.col(maxX)
      const y0 = this.row(minY)
      const y1 = this.row(maxY)
      for (let cx = x0; cx <= x1; cx++) {
        for (let cy = y0; cy <= y1; cy++) {
          const at = cx * this.rows + cy
          const list = this.cells[at]
          if (list) list.push(i)
          else this.cells[at] = [i]
        }
      }
    })
  }

  private col(x: number): number {
    return Math.min(this.cols - 1, Math.max(0, Math.floor((x - this.bounds.minX) / this.cell)))
  }

  private row(y: number): number {
    return Math.min(this.rows - 1, Math.max(0, Math.floor((y - this.bounds.minY) / this.cell)))
  }

  /** Whether a stroke with these bounds comes anywhere near the path. */
  overlaps(b: Bounds): boolean {
    const e = this.bounds
    return !(b.minX > e.maxX || b.maxX < e.minX || b.minY > e.maxY || b.maxY < e.minY)
  }

  /**
   * Whether an eraser segment within the radius of the box `minX..maxX, minY..maxY` passes `test`
   * (the exact distance check); each candidate is tested once, and the first pass ends the query.
   */
  private any(minX: number, minY: number, maxX: number, maxY: number, test: (c: readonly number[], d: readonly number[]) => boolean): boolean {
    const e = this.bounds
    if (minX > e.maxX || maxX < e.minX || minY > e.maxY || maxY < e.minY) return false
    const q = ++this.query
    const sb = this.segBounds
    const x1 = this.col(maxX)
    const y0 = this.row(minY)
    const y1 = this.row(maxY)
    for (let cx = this.col(minX); cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const list = this.cells[cx * this.rows + cy]
        if (!list) continue
        for (let k = 0; k < list.length; k++) {
          const i = list[k]
          if (this.seen[i] === q) continue
          this.seen[i] = q
          const o = i * 4
          if (sb[o] > maxX || sb[o + 2] < minX || sb[o + 1] > maxY || sb[o + 3] < minY) continue
          const [c, d] = this.segs[i]
          if (test(c, d)) return true
        }
      }
    }
    return false
  }

  /** Whether the path passes within the radius of the segment ab. */
  nearSegment(a: readonly number[], b: readonly number[]): boolean {
    return this.any(
      Math.min(a[0], b[0]),
      Math.min(a[1], b[1]),
      Math.max(a[0], b[0]),
      Math.max(a[1], b[1]),
      (c, d) => segSegDist2(a, b, c, d) <= this.r2,
    )
  }

  /** Whether the path passes within the radius of the point. */
  nearPoint(x: number, y: number): boolean {
    return this.any(x, y, x, y, (c, d) => pointSegDist2(x, y, c[0], c[1], d[0], d[1]) <= this.r2)
  }
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
  const index = new EraserIndex(eraserPath, radiusFlow)
  for (const s of strokes) {
    if (s.points.length === 0 || !index.overlaps(strokeBounds(s))) continue
    const pts = s.points
    if (pts.length === 1) {
      if (index.nearSegment(pts[0], pts[0])) hit.add(s.id)
      continue
    }
    for (let i = 0; i + 1 < pts.length; i++) {
      if (index.nearSegment(pts[i], pts[i + 1])) {
        hit.add(s.id)
        break
      }
    }
  }
  return hit
}

function sameStroke(a: InkStroke, b: InkStroke): boolean {
  if (a === b) return true
  return (
    a.d === b.d &&
    a.color === b.color &&
    a.width === b.width &&
    a.tool === b.tool &&
    a.points.length === b.points.length &&
    a.points.every((p, i) => p[0] === b.points[i][0] && p[1] === b.points[i][1] && p[2] === b.points[i][2])
  )
}

/**
 * Apply what changed locally since `base` (strokes added, removed and, since M8's ink select,
 * moved or scaled in place, by id) to `remote`. A stroke changed locally replaces the remote's
 * copy of it; one the remote removed stays removed.
 */
export function mergeStrokes(
  base: readonly InkStroke[],
  local: readonly InkStroke[],
  remote: readonly InkStroke[],
): InkStroke[] {
  const baseById = new Map(base.map((s) => [s.id, s]))
  const localIds = new Set(local.map((s) => s.id))
  const removed = new Set([...baseById.keys()].filter((id) => !localIds.has(id)))
  const changed = new Map<string, InkStroke>()
  for (const s of local) {
    const was = baseById.get(s.id)
    if (was && !sameStroke(was, s)) changed.set(s.id, s)
  }
  const out = remote.filter((s) => !removed.has(s.id)).map((s) => changed.get(s.id) ?? s)
  const have = new Set(out.map((s) => s.id))
  for (const s of local) {
    if (!baseById.has(s.id) && !have.has(s.id)) {
      out.push(s)
      have.add(s.id)
    }
  }
  return out
}

/**
 * The pointer type a stored stroke was most likely drawn with, for recomputing its outline: mouse
 * and touch record every pressure as 0.5, a pen almost never does.
 */
export function strokePointerType(stroke: Pick<InkStroke, 'points'>): 'pen' | 'mouse' {
  return stroke.points.every((p) => p[2] === 0.5) ? 'mouse' : 'pen'
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
