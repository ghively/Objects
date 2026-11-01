import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { THEME_COLORS } from '@/theme/palette'
import {
  DEFAULT_INK,
  ERASER_RADIUS_PX,
  HIGHLIGHTER_OPACITY,
  HIGHLIGHTER_WIDTHS,
  INK_COLORS,
  MAX_STROKE_POINTS,
  PEN_WIDTHS,
  SPLIT_STROKE_POINTS,
  finishStroke,
  hitStrokes,
  isBarrelButton,
  isEraserEnd,
  mergeStrokes,
  newStrokeId,
  outlineFor,
  penAltitude,
  samplesFrom,
  splitPoints,
  strokePointerType,
  tiltFactor,
  strokeOptions,
  svgPathFromOutline,
} from './inkModel'
import type { InkStroke } from './types'

/** The server's `d` rule (Task 2, `whiteboardink.validate_strokes`). */
const D_RULE = /^[MLQCZmlqcz0-9 ,.eE+-]*$/

function polygonArea(poly: number[][]): number {
  let a = 0
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i]
    const [x1, y1] = poly[(i + 1) % poly.length]
    a += x0 * y1 - x1 * y0
  }
  return Math.abs(a) / 2
}

function line(pressure: number): [number, number, number][] {
  const pts: [number, number, number][] = []
  for (let i = 0; i <= 20; i++) pts.push([i * 10, 0, pressure])
  return pts
}

function stroke(id: string, points: [number, number][]): InkStroke {
  return { id, tool: 'pen', color: '#5c5959', width: 2, points: points.map(([x, y]) => [x, y, 0.5]), d: 'M 0 0 Z' }
}

function fakePointer(init: Partial<PointerEvent> & { coalesced?: Partial<PointerEvent>[] }): PointerEvent {
  const { coalesced, ...rest } = init
  return {
    clientX: 0,
    clientY: 0,
    pressure: 0,
    buttons: 1,
    button: 0,
    pointerType: 'mouse',
    ...rest,
    getCoalescedEvents: coalesced ? () => coalesced as PointerEvent[] : undefined,
  } as unknown as PointerEvent
}

describe('ink model', () => {
  test('a stroke at the file point cap splits into pieces whose paths stay well under the server 1 MB cap', () => {
    // A wiggly pen path: every coordinate carries decimals, so `d` is as long as it gets.
    const pts: [number, number, number][] = []
    for (let i = 0; i < MAX_STROKE_POINTS; i++) {
      pts.push([1000 + Math.sin(i / 7) * 300 + i * 0.05, 2000 + Math.cos(i / 11) * 200, 0.3 + 0.4 * Math.abs(Math.sin(i / 5))])
    }
    const whole = finishStroke('X', 'pen', '#5c5959', 4, pts, 'pen')
    expect(new TextEncoder().encode(whole.d).length).toBeGreaterThan(1_000_000) // why splitting is needed
    const pieces = splitPoints(pts)
    expect(pieces.length).toBeGreaterThan(1)
    for (const piece of pieces) {
      expect(piece.length).toBeLessThanOrEqual(SPLIT_STROKE_POINTS)
      const d = finishStroke('Y', 'pen', '#5c5959', 4, piece, 'pen').d
      expect(new TextEncoder().encode(d).length).toBeLessThan(750_000)
    }
    // Consecutive pieces share their joining sample, so the line stays unbroken.
    expect(pieces[1][0]).toBe(pts[SPLIT_STROKE_POINTS - 1])
    expect(SPLIT_STROKE_POINTS).toBeLessThan(MAX_STROKE_POINTS)
  })

  test('constants', () => {
    expect(PEN_WIDTHS).toEqual([2, 4, 8])
    expect(HIGHLIGHTER_WIDTHS).toEqual([16, 32])
    expect(HIGHLIGHTER_OPACITY).toBe(0.35)
    expect(ERASER_RADIUS_PX).toBe(10)
    expect(DEFAULT_INK).toEqual({ tool: 'pen', color: '#5c5959', width: 4 })
  })

  test('higher pressure gives a wider outline', () => {
    const light = outlineFor(line(0.2), strokeOptions('pen', 8, 'pen', true))
    const heavy = outlineFor(line(1.0), strokeOptions('pen', 8, 'pen', true))
    expect(polygonArea(heavy)).toBeGreaterThan(2 * polygonArea(light))
  })

  test('mouse uses simulated pressure', () => {
    expect(strokeOptions('pen', 4, 'mouse').simulatePressure).toBe(true)
    expect(strokeOptions('pen', 4, 'touch').simulatePressure).toBe(true)
    expect(strokeOptions('pen', 4, 'pen').simulatePressure).toBe(false)
    const pen = strokeOptions('pen', 4, 'pen')
    expect(pen).toMatchObject({ size: 4, thinning: 0.5, smoothing: 0.5, streamline: 0.5, last: false })
    expect(strokeOptions('highlighter', 16, 'pen').thinning).toBe(0)
    expect(strokeOptions('pen', 4, 'pen', true).last).toBe(true)
  })

  test('samples use coalesced events and pen pressure', () => {
    const toFlow = (p: { x: number; y: number }) => ({ x: p.x / 2, y: p.y / 2 })
    const pen = fakePointer({
      pointerType: 'pen',
      clientX: 30,
      clientY: 30,
      pressure: 0.9,
      coalesced: [
        { clientX: 10, clientY: 10, pressure: 0.3 },
        { clientX: 20, clientY: 20, pressure: 0.6 },
        { clientX: 30, clientY: 30, pressure: 0.9 },
      ],
    })
    expect(samplesFrom(pen, toFlow)).toEqual([
      [5, 5, 0.3],
      [10, 10, 0.6],
      [15, 15, 0.9],
    ])
    const mouse = fakePointer({ pointerType: 'mouse', clientX: 8, clientY: 4, pressure: 0.5 })
    expect(samplesFrom(mouse, toFlow)).toEqual([[4, 2, 0.5]])
    const mouseZero = fakePointer({ pointerType: 'mouse', clientX: 8, clientY: 4, pressure: 0, coalesced: [] })
    expect(samplesFrom(mouseZero, toFlow)).toEqual([[4, 2, 0.5]])
  })

  test('eraser end and barrel button detection', () => {
    expect(isEraserEnd({ buttons: 32, button: -1, pointerType: 'pen' })).toBe(true)
    expect(isEraserEnd({ buttons: 0, button: 5, pointerType: 'pen' })).toBe(true)
    expect(isEraserEnd({ buttons: 1, button: 0, pointerType: 'pen' })).toBe(false)
    expect(isEraserEnd({ buttons: 0, button: 5, pointerType: 'mouse' })).toBe(false)
    expect(isBarrelButton({ buttons: 2 })).toBe(true)
    expect(isBarrelButton({ buttons: 3 })).toBe(true)
    expect(isBarrelButton({ buttons: 1 })).toBe(false)
  })

  test('svg path charset matches the server rule', () => {
    const s = finishStroke('s1', 'pen', '#3f80eb', 4, [
      [-10.123456, 5.5, 0.2],
      [-3.3333, 7.77777, 0.5],
      [12.5, -1e-7, 1],
    ], 'pen')
    expect(s.d.length).toBeGreaterThan(0)
    expect(s.d).toMatch(D_RULE)
    expect(s.d.startsWith('M ')).toBe(true)
    expect(s.d.endsWith(' Z')).toBe(true)
    expect(s.d).not.toMatch(/\d\.\d{3}/)
    expect(s.points).toEqual([
      [-10.12, 5.5, 0.2],
      [-3.33, 7.78, 0.5],
      [12.5, 0, 1],
    ])
    expect(s.colorName).toBe('blue')
    expect(svgPathFromOutline([])).toBe('')
    expect(svgPathFromOutline([[0, 0], [1, 0], [1, 1]])).toBe('M 0 0 Q 0 0 0.5 0 1 0 1 0.5 1 1 0.5 0.5 Z')
  })

  test('eraser hit test within 10 screen pixels', () => {
    const strokes = [stroke('a', [[0, 0], [100, 0]]), stroke('b', [[0, 50], [100, 50]])]
    // At zoom 1 the flow radius is 10: an eraser 9 units above "a" hits it, 11 doesn't.
    expect(hitStrokes(strokes, [[50, -9], [60, -9]], ERASER_RADIUS_PX / 1)).toEqual(new Set(['a']))
    expect(hitStrokes(strokes, [[50, -11], [60, -11]], ERASER_RADIUS_PX / 1)).toEqual(new Set())
    // At zoom 2 the flow radius is 5: 4.5 units hits, 6 doesn't.
    expect(hitStrokes(strokes, [[50, 45.5]], ERASER_RADIUS_PX / 2)).toEqual(new Set(['b']))
    expect(hitStrokes(strokes, [[50, 44]], ERASER_RADIUS_PX / 2)).toEqual(new Set())
    // A path crossing both strokes hits both.
    expect(hitStrokes(strokes, [[20, -20], [30, 80]], 1)).toEqual(new Set(['a', 'b']))
    // A path crossing between sampled points still hits (segment to segment, not point to point).
    expect(hitStrokes([stroke('c', [[0, 0], [1000, 0]])], [[500, -50], [500, 50]], 1)).toEqual(new Set(['c']))
    expect(hitStrokes(strokes, [], 10)).toEqual(new Set())
  })

  test('mergeStrokes keeps both sides’ additions and removals', () => {
    const a = stroke('a', [[0, 0]])
    const b = stroke('b', [[1, 1]])
    const c = stroke('c', [[2, 2]])
    const localNew = stroke('l', [[3, 3]])
    const remoteNew = stroke('r', [[4, 4]])
    const base = [a, b, c]
    const local = [a, c, localNew] // removed b, added l
    const remote = [b, c, remoteNew] // removed a, added r
    expect(mergeStrokes(base, local, remote).map((s) => s.id)).toEqual(['c', 'r', 'l'])
    expect(mergeStrokes(base, base, remote)).toEqual(remote)
    expect(mergeStrokes(base, local, base).map((s) => s.id)).toEqual(['a', 'c', 'l'])
  })

  test('new stroke ids are unique and match the id rule', () => {
    const ids = new Set(Array.from({ length: 200 }, () => newStrokeId()))
    expect(ids.size).toBe(200)
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]{1,64}$/)
  })

  test('ink colours match the line tokens', () => {
    const css = readFileSync(`${process.cwd()}/src/theme/tokens.css`, 'utf8')
    const token = (name: string): string => {
      const m = css.match(new RegExp(`${name}:\\s*([^;]+);`))
      expect(m, name).not.toBeNull()
      const v = m![1].trim()
      const ref = v.match(/^var\((--[\w-]+)\)$/)
      return ref ? token(ref[1]) : v.toLowerCase()
    }
    expect(INK_COLORS.map((c) => c.name)).toEqual([...THEME_COLORS])
    for (const c of INK_COLORS) expect(c.hex, c.name).toBe(token(`--line-${c.name}`))
    expect(INK_COLORS.find((c) => c.name === 'gray')?.hex).toBe('#5c5959')
    expect(INK_COLORS.find((c) => c.name === 'blue')?.hex).toBe('#3f80eb')
    expect(INK_COLORS.find((c) => c.name === 'yellow')?.hex).toBe('#daaa14')
  })

  test('tilt scales pressure', () => {
    const toFlow = (p: { x: number; y: number }) => p
    // Upright: no change. Laid flat: 60% (0.6 + 0.4 * sin(altitude)).
    expect(tiltFactor({ altitudeAngle: Math.PI / 2 })).toBeCloseTo(1)
    expect(tiltFactor({ altitudeAngle: 0 })).toBeCloseTo(0.6)
    expect(tiltFactor({ altitudeAngle: Math.PI / 6 })).toBeCloseTo(0.8)
    // Without altitudeAngle, tiltX/tiltY (degrees) give the altitude; none means upright.
    expect(penAltitude({})).toBeCloseTo(Math.PI / 2)
    expect(penAltitude({ tiltX: 45, tiltY: 0 })).toBeCloseTo(Math.PI / 4)
    expect(penAltitude({ tiltX: 90 })).toBe(0)
    const tilted = fakePointer({ pointerType: 'pen', clientX: 1, clientY: 2, pressure: 0.5, altitudeAngle: Math.PI / 6 } as Partial<PointerEvent>)
    expect(samplesFrom(tilted, toFlow)[0][2]).toBeCloseTo(0.4, 9)
    const byTilt = fakePointer({ pointerType: 'pen', clientX: 1, clientY: 2, pressure: 1, tiltX: 45, tiltY: 0 })
    expect(samplesFrom(byTilt, toFlow)[0][2]).toBeCloseTo(0.6 + 0.4 * Math.SQRT1_2, 6)
    // Coalesced samples use their own tilt, else the event's.
    const co = fakePointer({
      pointerType: 'pen',
      pressure: 1,
      altitudeAngle: 0,
      coalesced: [{ clientX: 0, clientY: 0, pressure: 1, altitudeAngle: Math.PI / 2 } as Partial<PointerEvent>, { clientX: 1, clientY: 0, pressure: 1 }],
    } as Partial<PointerEvent> & { coalesced: Partial<PointerEvent>[] })
    expect(samplesFrom(co, toFlow).map((p) => p[2])).toEqual([1, 0.6])
  })

  test('mouse input has no tilt effect', () => {
    const toFlow = (p: { x: number; y: number }) => p
    const mouse = fakePointer({ pointerType: 'mouse', clientX: 3, clientY: 4, pressure: 0.5, tiltX: 60, altitudeAngle: 0 } as Partial<PointerEvent>)
    expect(samplesFrom(mouse, toFlow)).toEqual([[3, 4, 0.5]])
    const touch = fakePointer({ pointerType: 'touch', clientX: 3, clientY: 4, pressure: 1, tiltY: 60 })
    expect(samplesFrom(touch, toFlow)).toEqual([[3, 4, 0.5]])
  })

  test('stroke pointer type is inferred from the recorded pressure', () => {
    expect(strokePointerType({ points: [[0, 0, 0.5], [1, 1, 0.5]] })).toBe('mouse')
    expect(strokePointerType({ points: [[0, 0, 0.5], [1, 1, 0.42]] })).toBe('pen')
  })
})
