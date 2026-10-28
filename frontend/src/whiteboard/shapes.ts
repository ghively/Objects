/**
 * Shape geometry for the 12 Capacities whiteboard shapes (`whiteboardShapes`).
 * The trimmed reference has the shape names but not their drawing, so the outlines are our
 * choice: each is a closed SVG path inside its `w × h` box, drawn with absolute `M`/`L`/`C`/`Q`
 * commands only (no arcs), so every coordinate stays inside the box and flips are a plain mirror.
 */
import type { WhiteboardShape } from '@/api/whiteboardTypes'
import type { Box } from './model'

type Pt = [number, number]
type Seg = { cmd: 'M' | 'L' | 'C' | 'Q'; pts: Pt[] }

export interface ShapeFlip {
  flipX?: boolean
  flipY?: boolean
}

/** Bezier circle constant: control points of a quarter ellipse stay on its bounding box. */
const KAPPA = 0.5522847498

const fmt = (n: number): string => {
  const r = Math.round(n * 100) / 100
  return Object.is(r, -0) ? '0' : String(r)
}

function polygon(points: Pt[]): Seg[] {
  return points.map((p, i) => ({ cmd: i === 0 ? 'M' : 'L', pts: [p] }))
}

/** A rounded rectangle body from `top` to `bottom`, with an optional tail on its bottom edge. */
function roundedBody(w: number, top: number, bottom: number, r: number, tail?: Pt[]): Seg[] {
  const segs: Seg[] = [
    { cmd: 'M', pts: [[r, top]] },
    { cmd: 'L', pts: [[w - r, top]] },
    { cmd: 'Q', pts: [[w, top], [w, top + r]] },
    { cmd: 'L', pts: [[w, bottom - r]] },
    { cmd: 'Q', pts: [[w, bottom], [w - r, bottom]] },
  ]
  for (const p of tail ?? []) segs.push({ cmd: 'L', pts: [p] })
  segs.push(
    { cmd: 'L', pts: [[r, bottom]] },
    { cmd: 'Q', pts: [[0, bottom], [0, bottom - r]] },
    { cmd: 'L', pts: [[0, top + r]] },
    { cmd: 'Q', pts: [[0, top], [r, top]] },
  )
  return segs
}

/** The bubble's body ends at 80 % of the height; the tail fills the rest. */
const BUBBLE_BODY = 0.8

function blockArrowHead(w: number, h: number): number {
  return w - Math.min(w * 0.45, h * 0.6)
}

function parallelogramSkew(w: number, h: number): number {
  return Math.min(w * 0.25, h * 0.5)
}

function segments(shape: WhiteboardShape, w: number, h: number): Seg[] {
  switch (shape) {
    case 'roundedRectangle': {
      const r = Math.min(16, w / 2, h / 2)
      return roundedBody(w, 0, h, r)
    }
    case 'ellipse': {
      const rx = w / 2
      const ry = h / 2
      const kx = rx * KAPPA
      const ky = ry * KAPPA
      return [
        { cmd: 'M', pts: [[rx, 0]] },
        { cmd: 'C', pts: [[rx + kx, 0], [w, ry - ky], [w, ry]] },
        { cmd: 'C', pts: [[w, ry + ky], [rx + kx, h], [rx, h]] },
        { cmd: 'C', pts: [[rx - kx, h], [0, ry + ky], [0, ry]] },
        { cmd: 'C', pts: [[0, ry - ky], [rx - kx, 0], [rx, 0]] },
      ]
    }
    case 'diamond':
      return polygon([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]])
    case 'triangle':
      return polygon([[w / 2, 0], [w, h], [0, h]])
    case 'triangleDown':
      return polygon([[0, 0], [w, 0], [w / 2, h]])
    case 'star': {
      // Five points, the top one at the top edge; stretched so the lowest points touch the bottom.
      const pts: Pt[] = []
      const outerY = (a: number) => Math.sin(a)
      const lowest = outerY((-90 + 72 * 2) * (Math.PI / 180)) // sin(54°)
      const ry = h / (1 + lowest)
      const cy = ry
      const rx = w / 2 / Math.cos((18 * Math.PI) / 180)
      const cx = w / 2
      for (let i = 0; i < 10; i++) {
        const a = ((-90 + 36 * i) * Math.PI) / 180
        const k = i % 2 === 0 ? 1 : 0.5
        pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k])
      }
      return polygon(pts.map(([x, y]) => [clamp(x, 0, w), clamp(y, 0, h)]))
    }
    case 'parallelogram': {
      const s = parallelogramSkew(w, h)
      return polygon([[s, 0], [w, 0], [w - s, h], [0, h]])
    }
    case 'bubble': {
      const bottom = h * BUBBLE_BODY
      const r = Math.min(12, w / 4, bottom / 2)
      return roundedBody(w, 0, bottom, r, [[w * 0.4, bottom], [w * 0.2, h], [w * 0.25, bottom]])
    }
    case 'blockArrow': {
      const hx = blockArrowHead(w, h)
      return polygon([[0, h / 4], [hx, h / 4], [hx, 0], [w, h / 2], [hx, h], [hx, (3 * h) / 4], [0, (3 * h) / 4]])
    }
    case 'blockArrowLeft': {
      const hx = w - blockArrowHead(w, h)
      return polygon([[w, h / 4], [hx, h / 4], [hx, 0], [0, h / 2], [hx, h], [hx, (3 * h) / 4], [w, (3 * h) / 4]])
    }
    case 'heart': {
      const u = (x: number, y: number): Pt => [x * w, y * h]
      return [
        { cmd: 'M', pts: [u(0.5, 0.25)] },
        { cmd: 'C', pts: [u(0.5, 0.1), u(0.38, 0), u(0.25, 0)] },
        { cmd: 'C', pts: [u(0.1, 0), u(0, 0.12), u(0, 0.28)] },
        { cmd: 'C', pts: [u(0, 0.55), u(0.3, 0.75), u(0.5, 1)] },
        { cmd: 'C', pts: [u(0.7, 0.75), u(1, 0.55), u(1, 0.28)] },
        { cmd: 'C', pts: [u(1, 0.12), u(0.9, 0), u(0.75, 0)] },
        { cmd: 'C', pts: [u(0.62, 0), u(0.5, 0.1), u(0.5, 0.25)] },
      ]
    }
    case 'rectangle':
    default:
      return polygon([[0, 0], [w, 0], [w, h], [0, h]])
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

/** The SVG path of `shape` in a `w × h` box, mirrored by `flipX`/`flipY`. Always closed (`Z`). */
export function shapePath(shape: WhiteboardShape, w: number, h: number, flip: ShapeFlip = {}): string {
  const W = Math.max(0, Number.isFinite(w) ? w : 0)
  const H = Math.max(0, Number.isFinite(h) ? h : 0)
  const mx = (x: number) => (flip.flipX ? W - x : x)
  const my = (y: number) => (flip.flipY ? H - y : y)
  const parts = segments(shape, W, H).map(
    (s) => s.cmd + ' ' + s.pts.map(([x, y]) => `${fmt(mx(x))} ${fmt(my(y))}`).join(' '),
  )
  return parts.join(' ') + ' Z'
}

/**
 * The box in-shape text sits in (shape-local coordinates): the whole box for rectangles, the
 * inscribed rectangle of an ellipse or diamond, the bubble without its tail, the triangle's lower
 * part, the block arrow's shaft and the heart's wide upper middle.
 */
export function textInset(shape: WhiteboardShape, w: number, h: number, flip: ShapeFlip = {}): Box {
  let box: Box
  switch (shape) {
    case 'ellipse': {
      const m = (1 - Math.SQRT1_2) / 2
      box = { x: w * m, y: h * m, width: w * (1 - 2 * m), height: h * (1 - 2 * m) }
      break
    }
    case 'diamond':
      box = { x: w / 4, y: h / 4, width: w / 2, height: h / 2 }
      break
    case 'triangle':
      box = { x: w / 4, y: h / 2, width: w / 2, height: h / 2 }
      break
    case 'triangleDown':
      box = { x: w / 4, y: 0, width: w / 2, height: h / 2 }
      break
    case 'star':
      box = { x: w * 0.3, y: h * 0.35, width: w * 0.4, height: h * 0.35 }
      break
    case 'parallelogram': {
      const s = parallelogramSkew(w, h)
      box = { x: s / 2, y: 0, width: Math.max(0, w - s), height: h }
      break
    }
    case 'bubble':
      box = { x: 0, y: 0, width: w, height: h * BUBBLE_BODY }
      break
    case 'blockArrow': {
      const hx = blockArrowHead(w, h)
      box = { x: 0, y: h / 4, width: hx + (w - hx) / 3, height: h / 2 }
      break
    }
    case 'blockArrowLeft': {
      const head = w - blockArrowHead(w, h)
      const x = head - head / 3
      box = { x, y: h / 4, width: w - x, height: h / 2 }
      break
    }
    case 'heart':
      box = { x: w * 0.2, y: h * 0.18, width: w * 0.6, height: h * 0.42 }
      break
    case 'roundedRectangle':
    case 'rectangle':
    default:
      box = { x: 0, y: 0, width: w, height: h }
  }
  if (flip.flipX) box = { ...box, x: w - box.x - box.width }
  if (flip.flipY) box = { ...box, y: h - box.y - box.height }
  return box
}
