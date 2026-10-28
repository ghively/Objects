import { describe, expect, test } from 'vitest'
import { finishStroke, mergeStrokes } from './inkModel'
import {
  cornerScale,
  handleAt,
  lassoSelect,
  scaleStrokes,
  selectionBounds,
  strokeAt,
  translatePath,
  translateStrokes,
} from './inkSelect'
import type { InkStroke } from './types'

function stroke(id: string, pts: [number, number][], pressure = 0.5): InkStroke {
  return finishStroke(id, 'pen', '#5c5959', 4, pts.map(([x, y]) => [x, y, pressure]), pressure === 0.5 ? 'mouse' : 'pen')
}

const square: [number, number, number][] = [
  [-10, -10, 0.5],
  [60, -10, 0.5],
  [60, 60, 0.5],
  [-10, 60, 0.5],
]

describe('inkSelect', () => {
  test('lasso selects strokes', () => {
    const inside = stroke('a', [[0, 0], [50, 50]])
    const partly = stroke('b', [[40, 40], [200, 40]])
    const outside = stroke('c', [[300, 300], [320, 320]])
    expect([...lassoSelect([inside, partly, outside], square)]).toEqual(['a'])
    // Fewer than three lasso points select nothing.
    expect(lassoSelect([inside], square.slice(0, 2)).size).toBe(0)
  })

  test('click picks the topmost stroke near the point', () => {
    const a = stroke('a', [[0, 0], [100, 0]])
    const b = stroke('b', [[0, 4], [100, 4]])
    expect(strokeAt([a, b], 50, 2, 5)).toBe('b')
    expect(strokeAt([a, b], 50, 80, 5)).toBeNull()
  })

  test('moving a stroke rewrites only that stroke', () => {
    const a = stroke('a', [[0, 0], [100, 0]])
    const b = stroke('b', [[0, 200], [100, 200]])
    const next = translateStrokes([a, b], new Set(['a']), 10, 5)
    expect(next[1]).toBe(b)
    expect(next[0].id).toBe('a')
    expect(next[0].points).toEqual([
      [10, 5, 0.5],
      [110, 5, 0.5],
    ])
    // The outline moves exactly with the points: same as drawing it there.
    const drawn = finishStroke('a', 'pen', '#5c5959', 4, next[0].points, 'mouse')
    const nums = (d: string) => d.split(' ').filter((t) => !/[MQZ]/.test(t)).map(Number)
    const got = nums(next[0].d)
    const want = nums(drawn.d)
    expect(got).toHaveLength(want.length)
    got.forEach((n, i) => expect(Math.abs(n - want[i])).toBeLessThan(0.02))
    // A move of zero changes nothing.
    expect(translateStrokes([a, b], new Set(['a']), 0, 0)).toEqual([a, b])
  })

  test('translatePath moves coordinate pairs and refuses other shapes', () => {
    expect(translatePath('M 1 2 Q 3 4 5 6 Z', 1, -1)).toBe('M 2 1 Q 4 3 6 5 Z')
    expect(translatePath('M 1 2 L 3 4', 1, 1)).toBeNull()
  })

  test('scaling recomputes points', () => {
    const a = stroke('a', [[0, 0], [100, 0], [100, 50]], 0.7)
    const b = stroke('b', [[0, 200], [100, 200]])
    const next = scaleStrokes([a, b], new Set(['a']), 0, 0, 2)
    expect(next[1]).toBe(b)
    expect(next[0].id).toBe('a')
    expect(next[0].points).toEqual([
      [0, 0, 0.7],
      [200, 0, 0.7],
      [200, 100, 0.7],
    ])
    expect(next[0].width).toBe(8)
    expect(next[0].d).toBe(finishStroke('a', 'pen', '#5c5959', 8, next[0].points, 'pen').d)
    expect(next[0].d).not.toBe(a.d)
  })

  test('corner handles: hit test and uniform scale from the opposite corner', () => {
    const a = stroke('a', [[0, 0], [100, 50]])
    const box = selectionBounds([a], new Set(['a']))!
    expect(box).toEqual({ minX: -2, minY: -2, maxX: 102, maxY: 52 })
    expect(handleAt(box, 101, 51, 8)).toBe('se')
    expect(handleAt(box, -1, -3, 8)).toBe('nw')
    expect(handleAt(box, 50, 25, 8)).toBeNull()
    // Dragging se to twice the width doubles it (the larger ratio wins), anchored at nw.
    expect(cornerScale(box, 'se', 206, 52)).toBeCloseTo(2)
    expect(cornerScale(box, 'se', -500, -500)).toBe(0.05)
  })

  test('merge keeps a local move over the remote copy', () => {
    const a = stroke('a', [[0, 0], [100, 0]])
    const b = stroke('b', [[0, 200], [100, 200]])
    const c = stroke('c', [[0, 400], [100, 400]])
    const moved = translateStrokes([a, b], new Set(['a']), 10, 10)
    // The other window added c; our move of a survives, b stays as it was.
    const merged = mergeStrokes([a, b], moved, [a, b, c])
    expect(merged.map((s) => s.id)).toEqual(['a', 'b', 'c'])
    expect(merged[0]).toBe(moved[0])
    expect(merged[1]).toBe(b)
    // A stroke the other window erased stays erased, even if we moved it.
    expect(mergeStrokes([a, b], moved, [b]).map((s) => s.id)).toEqual(['b'])
  })
})
