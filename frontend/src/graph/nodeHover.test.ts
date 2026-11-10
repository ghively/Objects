import { describe, expect, test } from 'vitest'
import { drawNodeHover } from './graphStyle'

// A canvas context that records what was filled with which colour.
function recorder() {
  const calls: { op: string; style: string; text?: string }[] = []
  const ctx = {
    font: '',
    fillStyle: '',
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    shadowBlur: 0,
    shadowColor: '',
    measureText: (t: string) => ({ width: t.length * 6 }),
    beginPath() {},
    moveTo() {},
    lineTo() {},
    arc() {},
    closePath() {},
    fill() {
      calls.push({ op: 'fill', style: String(ctx.fillStyle) })
    },
    fillText(text: string) {
      calls.push({ op: 'text', style: String(ctx.fillStyle), text })
    },
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls }
}

const SETTINGS = { labelSize: 12, labelFont: 'Inter', labelWeight: 'normal' }

describe('the hovered node label (audit 2026-11-10)', () => {
  test('draws its box in the theme background and its name in the label colour, never white on white', () => {
    const { ctx, calls } = recorder()
    drawNodeHover(ctx, { x: 10, y: 10, size: 4, label: 'APP-TEST-01' }, SETTINGS, '#1f1f22', '#f4f4f5')
    expect(calls).toEqual([
      { op: 'fill', style: '#1f1f22' },
      { op: 'text', style: '#f4f4f5', text: 'APP-TEST-01' },
    ])
  })

  test('a node without a label gets the round box only', () => {
    const { ctx, calls } = recorder()
    drawNodeHover(ctx, { x: 0, y: 0, size: 4, label: null }, SETTINGS, '#fff', '#111')
    expect(calls).toEqual([{ op: 'fill', style: '#fff' }])
  })
})
