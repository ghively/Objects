/**
 * Snap to nodes ("Snap to nodes" in Canvas display): while a box moves, its left, centre and
 * right line up with another node's left, centre or right when they are within `threshold`
 * flow units (and likewise top, middle and bottom). The guides are the lines to draw.
 */
import type { Box } from './model'

export interface SnapGuide {
  /** `vertical` is a line at `x = position`; `horizontal` at `y = position`. */
  orientation: 'vertical' | 'horizontal'
  position: number
  /** The span the line covers along the other axis (both boxes). */
  start: number
  end: number
}

export interface NodeSnap {
  dx: number
  dy: number
  guides: SnapGuide[]
}

const xs = (b: Box): number[] => [b.x, b.x + b.width / 2, b.x + b.width]
const ys = (b: Box): number[] => [b.y, b.y + b.height / 2, b.y + b.height]

function best(moving: number[], others: number[][], threshold: number): number | null {
  let found: number | null = null
  for (const lines of others) {
    for (const o of lines) {
      for (const m of moving) {
        const d = o - m
        if (Math.abs(d) <= threshold && (found === null || Math.abs(d) < Math.abs(found))) found = d
      }
    }
  }
  return found
}

const EPS = 1e-6

export function snapToNodes(moving: Box, others: readonly Box[], threshold = 6): NodeSnap {
  const dx = best(xs(moving), others.map(xs), threshold) ?? 0
  const dy = best(ys(moving), others.map(ys), threshold) ?? 0
  const snapped: Box = { ...moving, x: moving.x + dx, y: moving.y + dy }
  const guides: SnapGuide[] = []
  const add = (g: SnapGuide) => {
    const prev = guides.find((x) => x.orientation === g.orientation && Math.abs(x.position - g.position) < EPS)
    if (prev) {
      prev.start = Math.min(prev.start, g.start)
      prev.end = Math.max(prev.end, g.end)
    } else guides.push(g)
  }
  for (const o of others) {
    for (const m of xs(snapped)) {
      if (xs(o).some((v) => Math.abs(v - m) < EPS)) {
        add({
          orientation: 'vertical',
          position: m,
          start: Math.min(snapped.y, o.y),
          end: Math.max(snapped.y + snapped.height, o.y + o.height),
        })
      }
    }
    for (const m of ys(snapped)) {
      if (ys(o).some((v) => Math.abs(v - m) < EPS)) {
        add({
          orientation: 'horizontal',
          position: m,
          start: Math.min(snapped.x, o.x),
          end: Math.max(snapped.x + snapped.width, o.x + o.width),
        })
      }
    }
  }
  return { dx, dy, guides }
}
