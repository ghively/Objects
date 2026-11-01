import { describe, expect, test } from 'vitest'
import { finishStroke, hitStrokes, outlineFor, strokeOptions, svgPathFromOutline, MAX_STROKE_POINTS } from './ink/inkModel'
import { erasePartially } from './ink/inkErase'
import type { InkStroke } from './ink/types'

function longStroke(n: number, scale = 1): [number, number, number][] {
  const pts: [number, number, number][] = []
  for (let i = 0; i < n; i++) pts.push([1000 + Math.sin(i / 7) * 300 * scale + i * 0.05, 2000 + Math.cos(i / 11) * 200 * scale, 0.3 + 0.4 * Math.abs(Math.sin(i / 5))])
  return pts
}

describe('audit: ink limits and costs', () => {
  test('a stroke at the client point cap (20,000) produces a d over the server 1 MB cap', () => {
    const s = finishStroke('X', 'pen', '#5c5959', 4, longStroke(MAX_STROKE_POINTS), 'pen')
    const bytes = new TextEncoder().encode(s.d).length
    console.log(`20,000-point pen stroke: d = ${(bytes / 1e6).toFixed(2)} MB (server MAX_D_BYTES = 1 MB); points JSON = ${(JSON.stringify(s.points).length / 1e6).toFixed(2)} MB`)
    const mid = finishStroke('Y', 'pen', '#5c5959', 4, longStroke(12000), 'pen')
    console.log(`12,000-point pen stroke: d = ${(new TextEncoder().encode(mid.d).length / 1e6).toFixed(2)} MB`)
    expect(bytes).toBeLessThanOrEqual(1_000_000)
  })

  test('live preview cost: full outline recompute per pointer move', () => {
    const pts = longStroke(3000)
    const opts = strokeOptions('pen', 4, 'pen')
    const t0 = performance.now()
    for (let k = 0; k < 20; k++) svgPathFromOutline(outlineFor(pts, opts))
    const ms = (performance.now() - t0) / 20
    console.log(`LivePath recompute for a 3,000-point stroke: ${ms.toFixed(2)} ms per pointer move`)
    expect(ms).toBeLessThan(4)
  })

  test('eraser hit test cost over many strokes', () => {
    const strokes: InkStroke[] = []
    for (let s = 0; s < 2000; s++) {
      const pts: [number, number, number][] = []
      for (let i = 0; i < 100; i++) pts.push([(s % 40) * 50 + i * 0.5, Math.floor(s / 40) * 50 + Math.sin(i) * 10, 0.5])
      strokes.push({ id: `s${s}`, tool: 'pen', color: '#000000', width: 4, points: pts, d: '' })
    }
    const eraser: [number, number, number][] = []
    for (let i = 0; i < 150; i++) eraser.push([i * 13, 1000 + i * 8, 0.5])
    let t0 = performance.now()
    const hit = hitStrokes(strokes, eraser, 10)
    const whole = performance.now() - t0
    t0 = performance.now()
    const cut = erasePartially(strokes, eraser, 10)
    const partial = performance.now() - t0
    console.log(`eraser over 2,000 strokes x 100 pts with a 150-pt path: whole=${whole.toFixed(0)} ms (hit ${hit.size}), partial=${partial.toFixed(0)} ms (changed ${cut.changed})`)
    expect(whole).toBeLessThan(50)
  })
})
