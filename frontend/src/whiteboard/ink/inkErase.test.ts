import { describe, expect, test } from 'vitest'
import { erasePartially } from './inkErase'
import { finishStroke, hitStrokes } from './inkModel'
import type { InkStroke } from './types'

function stroke(id: string, pts: [number, number][]): InkStroke {
  return finishStroke(id, 'pen', '#3f80eb', 4, pts.map(([x, y]) => [x, y, 0.5]), 'mouse')
}

function ids() {
  let n = 0
  return () => `new${++n}`
}

describe('erasePartially', () => {
  test('partial erase splits a stroke', () => {
    // A two-point stroke: the eraser crosses its middle, between the samples.
    const a = stroke('a', [[0, 0], [100, 0]])
    const b = stroke('b', [[0, 200], [100, 200]])
    const { strokes, changed } = erasePartially([a, b], [[50, -20, 0.5], [50, 20, 0.5]], 5, ids())
    expect(changed).toBe(true)
    expect(strokes.map((s) => s.id)).toEqual(['new1', 'new2', 'b'])
    expect(strokes[2]).toBe(b)
    const [left, right] = strokes
    expect(left.points.every(([x]) => x <= 45.01)).toBe(true)
    expect(right.points.every(([x]) => x >= 54.99)).toBe(true)
    expect(left.points[0]).toEqual([0, 0, 0.5])
    expect(right.points[right.points.length - 1]).toEqual([100, 0, 0.5])
    expect(left.tool).toBe('pen')
    expect(left.color).toBe('#3f80eb')
    expect(left.colorName).toBe('blue')
    expect(left.d).toBe(finishStroke('new1', 'pen', '#3f80eb', 4, left.points, 'mouse').d)
    // The pieces no longer pass under the eraser.
    expect(hitStrokes([left, right], [[50, -20, 0.5], [50, 20, 0.5]], 4.9).size).toBe(0)
  })

  test('erasing a stroke end leaves one piece; erasing all of it removes it', () => {
    const a = stroke('a', [[0, 0], [100, 0]])
    const end = erasePartially([a], [[100, -20, 0.5], [100, 20, 0.5]], 5, ids())
    expect(end.strokes.map((s) => s.id)).toEqual(['new1'])
    const all = erasePartially([a], [[-10, 0, 0.5], [110, 0, 0.5]], 5, ids())
    expect(all.changed).toBe(true)
    expect(all.strokes).toEqual([])
  })

  test('a miss changes nothing', () => {
    const a = stroke('a', [[0, 0], [100, 0]])
    const r = erasePartially([a], [[0, 100, 0.5], [100, 100, 0.5]], 5, ids())
    expect(r.changed).toBe(false)
    expect(r.strokes[0]).toBe(a)
  })
})
