import { describe, expect, test } from 'vitest'
import { ZOOM_MAX, ZOOM_MIN, ZOOM_PRESETS } from './model'
import { fitBox, wheelViewport, zoomAbout, zoomStep } from './camera'

const toFlow = (v: { x: number; y: number; zoom: number }, px: number, py: number) => ({
  x: (px - v.x) / v.zoom,
  y: (py - v.y) / v.zoom,
})

describe('camera', () => {
  test('wheel zooms about the pointer within limits; pans when zoom on scroll is off', () => {
    const v = { x: 40, y: -20, zoom: 1 }
    const e = { deltaX: 0, deltaY: -100, ctrlKey: false, clientX: 300, clientY: 200 }
    const zoomed = wheelViewport(v, e, true)
    expect(zoomed.zoom).toBeGreaterThan(1)
    const before = toFlow(v, 300, 200)
    const after = toFlow(zoomed, 300, 200)
    expect(after.x).toBeCloseTo(before.x)
    expect(after.y).toBeCloseTo(before.y)

    const out = wheelViewport(v, { ...e, deltaY: 100 }, true)
    expect(out.zoom).toBeLessThan(1)

    let z = v
    for (let i = 0; i < 200; i++) z = wheelViewport(z, { ...e, deltaY: -500 }, true)
    expect(z.zoom).toBe(ZOOM_MAX)
    for (let i = 0; i < 400; i++) z = wheelViewport(z, { ...e, deltaY: 500 }, true)
    expect(z.zoom).toBe(ZOOM_MIN)

    const panned = wheelViewport(v, { ...e, deltaX: 10, deltaY: 30 }, false)
    expect(panned).toEqual({ x: 30, y: -50, zoom: 1 })
    // Ctrl (a trackpad pinch) zooms even with zoom on scroll off
    expect(wheelViewport(v, { ...e, ctrlKey: true }, false).zoom).toBeGreaterThan(1)
    // Shift turns vertical scrolling into horizontal panning
    expect(wheelViewport(v, { ...e, deltaY: 30, shiftKey: true }, false)).toEqual({ x: 10, y: -20, zoom: 1 })
  })

  test('zoomAbout keeps the point under the pointer and clamps', () => {
    const v = { x: 0, y: 0, zoom: 1 }
    const r = zoomAbout(v, 2, 100, 100)
    expect(r).toEqual({ x: -100, y: -100, zoom: 2 })
    expect(zoomAbout(v, 100, 0, 0).zoom).toBe(ZOOM_MAX)
    expect(zoomAbout(v, 0, 0, 0).zoom).toBe(ZOOM_MIN)
  })

  test('fit shows every box centred; empty is zoom 1 at the origin; never past 100 %', () => {
    expect(fitBox([], { width: 800, height: 600 })).toEqual({ x: 0, y: 0, zoom: 1 })
    const big = fitBox([{ x: 0, y: 0, width: 1600, height: 600 }, { x: 0, y: 600, width: 10, height: 600 }], { width: 800, height: 600 }, 0)
    expect(big.zoom).toBeCloseTo(0.5)
    expect(big.x).toBeCloseTo(0)
    expect(big.y).toBeCloseTo(0)
    const padded = fitBox([{ x: 0, y: 0, width: 1000, height: 100 }], { width: 1100, height: 600 }, 50)
    expect(padded.zoom).toBeCloseTo(1)
    const small = fitBox([{ x: 100, y: 100, width: 50, height: 50 }], { width: 800, height: 600 }, 40)
    expect(small.zoom).toBe(1)
    expect(small).toEqual({ x: 400 - 125, y: 300 - 125, zoom: 1 })
  })

  test('zoom steps through presets', () => {
    expect(zoomStep(1, 'in')).toBe(1.25)
    expect(zoomStep(1, 'out')).toBe(0.75)
    expect(zoomStep(0.8, 'in')).toBe(1)
    expect(zoomStep(0.8, 'out')).toBe(0.75)
    expect(zoomStep(3, 'in')).toBe(ZOOM_MAX)
    expect(zoomStep(0.05, 'out')).toBe(ZOOM_MIN)
    const walk: number[] = []
    let z: number = ZOOM_MIN
    while (z < ZOOM_MAX) {
      z = zoomStep(z, 'in')
      walk.push(z)
    }
    expect(walk).toEqual([...ZOOM_PRESETS, ZOOM_MAX])
  })
})
