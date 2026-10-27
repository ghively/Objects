import { finishStroke, newStrokeId, pointSegDist2, segSegDist2, segments, strokeBounds, strokePointerType } from './inkModel'
import type { InkStroke } from './types'

/** The file's point limit per stroke (`whiteboardink.MAX_POINTS`). */
const MAX_POINTS = 20_000

type P = [number, number, number]

/**
 * The stroke's points with extra samples along long segments (at most `step` apart; pressure
 * interpolated), so the eraser can cut between two far-apart samples.
 */
function densify(points: readonly P[], step: number): P[] {
  if (points.length < 2 || step <= 0) return points.map((p) => [...p] as P)
  const out: P[] = [[...points[0]] as P]
  for (let i = 1; i < points.length; i++) {
    const [ax, ay, ap] = points[i - 1]
    const [bx, by, bp] = points[i]
    const n = Math.ceil(Math.hypot(bx - ax, by - ay) / step)
    for (let k = 1; k < n; k++) {
      const t = k / n
      out.push([ax + (bx - ax) * t, ay + (by - ay) * t, ap + (bp - ap) * t])
    }
    out.push([bx, by, bp])
    if (out.length > MAX_POINTS) return points.map((p) => [...p] as P)
  }
  return out
}

/**
 * The eraser's "Erase partially" mode (our string): cut every stroke where the eraser path passes
 * within `radiusFlow`, leaving the remaining runs of the stroke as new strokes with fresh ids, in
 * the cut stroke's place. A stroke the eraser misses is returned as the same object. `changed`
 * is false when nothing was cut.
 */
export function erasePartially(
  strokes: readonly InkStroke[],
  eraserPath: readonly (readonly number[])[],
  radiusFlow: number,
  newId: () => string = newStrokeId,
): { strokes: InkStroke[]; changed: boolean } {
  if (eraserPath.length === 0) return { strokes: [...strokes], changed: false }
  const eb = strokeBounds({ points: eraserPath as P[] })
  const eraserSegs = segments(eraserPath)
  const r2 = radiusFlow * radiusFlow
  const near = (x: number, y: number) => eraserSegs.some(([c, d]) => pointSegDist2(x, y, c[0], c[1], d[0], d[1]) <= r2)
  let changed = false
  const out: InkStroke[] = []
  for (const s of strokes) {
    const b = strokeBounds(s)
    const misses =
      s.points.length === 0 ||
      b.minX - radiusFlow > eb.maxX ||
      b.maxX + radiusFlow < eb.minX ||
      b.minY - radiusFlow > eb.maxY ||
      b.maxY + radiusFlow < eb.minY
    if (misses) {
      out.push(s)
      continue
    }
    const pts = densify(s.points, Math.max(radiusFlow / 2, 0.01))
    const runs: P[][] = []
    let run: P[] = []
    let cut = false
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]
      if (near(p[0], p[1])) {
        cut = true
        if (run.length) runs.push(run)
        run = []
        continue
      }
      // Two kept neighbours whose segment the eraser still crosses: break between them.
      if (run.length && eraserSegs.some(([c, d]) => segSegDist2(run[run.length - 1], p, c, d) <= r2)) {
        cut = true
        runs.push(run)
        run = []
      }
      run.push(p)
    }
    if (run.length) runs.push(run)
    if (!cut) {
      out.push(s)
      continue
    }
    changed = true
    const pointerType = strokePointerType(s)
    for (const r of runs) {
      const piece = finishStroke(newId(), s.tool, s.color, s.width, r, pointerType)
      if (s.colorName && !piece.colorName) piece.colorName = s.colorName
      out.push(piece)
    }
  }
  return { strokes: out, changed }
}
