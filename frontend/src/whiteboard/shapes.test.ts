import { describe, expect, test } from 'vitest'
import { SHAPES } from './model'
import { shapePath, textInset } from './shapes'

/** The coordinate pairs of a path made of absolute M/L/C/Q commands. */
function points(d: string): [number, number][] {
  const nums = d
    .replace(/[MLCQZ]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(Number)
  const out: [number, number][] = []
  for (let i = 0; i < nums.length; i += 2) out.push([nums[i], nums[i + 1]])
  return out
}

describe('shapePath', () => {
  test('every shape path is closed and inside its box; flips mirror', () => {
    expect(SHAPES).toHaveLength(12)
    for (const shape of SHAPES) {
      for (const [w, h] of [
        [90, 90],
        [240, 120],
        [60, 300],
      ]) {
        const d = shapePath(shape, w, h)
        expect(d.startsWith('M '), shape).toBe(true)
        expect(d.endsWith(' Z'), shape).toBe(true)
        expect(d).not.toMatch(/NaN|Infinity|[AaHhVvSsTt]/)
        const pts = points(d)
        expect(pts.length, shape).toBeGreaterThanOrEqual(3)
        for (const [x, y] of pts) {
          expect(x, `${shape} x`).toBeGreaterThanOrEqual(0)
          expect(x, `${shape} x`).toBeLessThanOrEqual(w)
          expect(y, `${shape} y`).toBeGreaterThanOrEqual(0)
          expect(y, `${shape} y`).toBeLessThanOrEqual(h)
        }
        const fx = points(shapePath(shape, w, h, { flipX: true }))
        const fy = points(shapePath(shape, w, h, { flipY: true }))
        const fxy = points(shapePath(shape, w, h, { flipX: true, flipY: true }))
        pts.forEach(([x, y], i) => {
          expect(fx[i][0]).toBeCloseTo(w - x, 1)
          expect(fx[i][1]).toBeCloseTo(y, 1)
          expect(fy[i][0]).toBeCloseTo(x, 1)
          expect(fy[i][1]).toBeCloseTo(h - y, 1)
          expect(fxy[i][0]).toBeCloseTo(w - x, 1)
          expect(fxy[i][1]).toBeCloseTo(h - y, 1)
        })
      }
    }
  })

  test('the outline touches all four edges of its box', () => {
    for (const shape of SHAPES) {
      const pts = points(shapePath(shape, 200, 100))
      const xs = pts.map((p) => p[0])
      const ys = pts.map((p) => p[1])
      expect(Math.min(...xs), shape).toBeCloseTo(0, 0)
      expect(Math.max(...xs), shape).toBeCloseTo(200, 0)
      expect(Math.min(...ys), shape).toBeCloseTo(0, 0)
      expect(Math.max(...ys), shape).toBeCloseTo(100, 0)
    }
  })

  test('a rectangle is its box; a zero or invalid size stays finite', () => {
    expect(shapePath('rectangle', 90, 60)).toBe('M 0 0 L 90 0 L 90 60 L 0 60 Z')
    expect(shapePath('ellipse', 0, Number.NaN)).not.toMatch(/NaN/)
  })
})

describe('textInset', () => {
  test('text box lies inside the shape box for every shape', () => {
    for (const shape of SHAPES) {
      const b = textInset(shape, 200, 100)
      expect(b.x, shape).toBeGreaterThanOrEqual(0)
      expect(b.y, shape).toBeGreaterThanOrEqual(0)
      expect(b.x + b.width, shape).toBeLessThanOrEqual(200 + 1e-9)
      expect(b.y + b.height, shape).toBeLessThanOrEqual(100 + 1e-9)
      expect(b.width, shape).toBeGreaterThan(0)
      expect(b.height, shape).toBeGreaterThan(0)
    }
  })

  test('the bubble leaves out its tail and the triangle uses its lower part; flips mirror', () => {
    expect(textInset('rectangle', 200, 100)).toEqual({ x: 0, y: 0, width: 200, height: 100 })
    expect(textInset('bubble', 200, 100)).toEqual({ x: 0, y: 0, width: 200, height: 80 })
    expect(textInset('triangle', 200, 100)).toEqual({ x: 50, y: 50, width: 100, height: 50 })
    expect(textInset('bubble', 200, 100, { flipY: true })).toEqual({ x: 0, y: 20, width: 200, height: 80 })
    const arrow = textInset('blockArrow', 200, 100)
    const flipped = textInset('blockArrow', 200, 100, { flipX: true })
    expect(flipped.x).toBeCloseTo(200 - arrow.x - arrow.width)
  })
})
