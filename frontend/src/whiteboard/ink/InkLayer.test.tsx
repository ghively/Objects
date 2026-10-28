import '@/whiteboard/test/flowEnv'
import { act, render } from '@testing-library/react'
import { ReactFlow, ReactFlowProvider } from '@xyflow/react'
import { describe, expect, test, vi } from 'vitest'
import { InkLayer } from './InkLayer'
import { DEFAULT_INK, finishStroke } from './inkModel'
import type { InkLayerProps, InkStroke, InkToolState } from './types'

type Sample = { x: number; y: number; pressure?: number }

interface PInit {
  pointerType: string
  x: number
  y: number
  pressure?: number
  buttons?: number
  button?: number
  pointerId?: number
  coalesced?: Sample[]
}

/** A jsdom pointer event with the fields the layer reads, forced onto the instance. */
function pointer(type: string, init: PInit): PointerEvent {
  const ev = new PointerEvent(type, { bubbles: true, cancelable: true, clientX: init.x, clientY: init.y })
  const fields: Record<string, unknown> = {
    pointerType: init.pointerType,
    pressure: init.pressure ?? (init.pointerType === 'pen' ? 0.5 : 0),
    buttons: init.buttons ?? (type === 'pointerup' ? 0 : 1),
    button: init.button ?? 0,
    pointerId: init.pointerId ?? 1,
    clientX: init.x,
    clientY: init.y,
  }
  for (const [k, v] of Object.entries(fields)) Object.defineProperty(ev, k, { value: v, configurable: true })
  if (init.coalesced) {
    const list = init.coalesced.map((c) => ({
      clientX: c.x,
      clientY: c.y,
      pressure: c.pressure ?? 0,
      pointerType: init.pointerType,
    }))
    Object.defineProperty(ev, 'getCoalescedEvents', { value: () => list, configurable: true })
  }
  return ev
}

function fire(el: Element, type: string, init: PInit) {
  act(() => {
    el.dispatchEvent(pointer(type, init))
  })
}

function setup(props: Partial<InkLayerProps> = {}) {
  const onStrokesChange = vi.fn()
  const onWheel = vi.fn()
  const all: InkLayerProps = {
    strokes: [],
    tool: DEFAULT_INK,
    readOnly: false,
    panning: false,
    onStrokesChange,
    onWheel,
    ...props,
  }
  const utils = render(
    <div style={{ width: 1280, height: 800 }}>
      <ReactFlowProvider>
        <ReactFlow nodes={[]} edges={[]}>
          <InkLayer {...all} />
        </ReactFlow>
      </ReactFlowProvider>
    </div>,
  )
  const capture = () => utils.container.querySelector('[data-ink-capture]')
  return { ...utils, capture, onStrokesChange, onWheel, props: all }
}

function stroke(id: string, pts: [number, number][]): InkStroke {
  return finishStroke(id, 'pen', '#5c5959', 4, pts.map(([x, y]) => [x, y, 0.5]), 'mouse')
}

describe('InkLayer', () => {
  test('pen pointer events record pressure and coalesced samples', () => {
    const { capture, onStrokesChange } = setup()
    const el = capture()!
    expect(el).not.toBeNull()
    fire(el, 'pointerdown', { pointerType: 'pen', x: 10, y: 10, pressure: 0.2 })
    fire(el, 'pointermove', {
      pointerType: 'pen',
      x: 40,
      y: 10,
      pressure: 0.9,
      coalesced: [
        { x: 20, y: 10, pressure: 0.4 },
        { x: 30, y: 10, pressure: 0.6 },
        { x: 40, y: 10, pressure: 0.9 },
      ],
    })
    fire(el, 'pointerup', { pointerType: 'pen', x: 40, y: 10, pressure: 0 })
    expect(onStrokesChange).toHaveBeenCalledTimes(1)
    const [next, label] = onStrokesChange.mock.calls[0]
    expect(label).toBe('draw')
    expect(next).toHaveLength(1)
    const s = next[0] as InkStroke
    expect(s.tool).toBe('pen')
    expect(s.width).toBe(4)
    expect(s.points.map((p) => p[2])).toEqual([0.2, 0.4, 0.6, 0.9])
    expect(s.points.map((p) => p[0])).toEqual([10, 20, 30, 40])
    expect(s.d.startsWith('M ')).toBe(true)
  })

  test('a stroke longer than the file allows is saved as several strokes', () => {
    const { capture, onStrokesChange } = setup()
    const el = capture()!
    fire(el, 'pointerdown', { pointerType: 'pen', x: 0, y: 0, pressure: 0.5 })
    const coalesced = Array.from({ length: 25_000 }, (_, i) => ({ x: (i + 1) / 10, y: (i % 7) / 10, pressure: 0.5 }))
    fire(el, 'pointermove', { pointerType: 'pen', x: 2500, y: 0, pressure: 0.5, coalesced })
    fire(el, 'pointerup', { pointerType: 'pen', x: 2500, y: 0, pressure: 0 })
    const next = onStrokesChange.mock.calls[0][0] as InkStroke[]
    expect(next.length).toBeGreaterThan(1)
    expect(next.every((s) => s.points.length <= 20_000)).toBe(true)
    expect(new Set(next.map((s) => s.id)).size).toBe(next.length)
    // Consecutive pieces share their joining sample, so the line stays unbroken.
    expect(next[1].points[0]).toEqual(next[0].points.at(-1))
    expect(next.reduce((n, s) => n + s.points.length, 0)).toBe(25_001 + next.length - 1)
  })

  test('mouse stroke uses simulated pressure', () => {
    const { capture, onStrokesChange } = setup()
    const el = capture()!
    fire(el, 'pointerdown', { pointerType: 'mouse', x: 0, y: 0, pressure: 0.5 })
    fire(el, 'pointermove', { pointerType: 'mouse', x: 30, y: 30, pressure: 0.5 })
    fire(el, 'pointerup', { pointerType: 'mouse', x: 30, y: 30 })
    const s = onStrokesChange.mock.calls[0][0][0] as InkStroke
    expect(s.points.every((p) => p[2] === 0.5)).toBe(true)
    // The outline matches one built with simulatePressure (mouse), not the pen's raw pressure.
    expect(s.d).toBe(finishStroke('x', 'pen', DEFAULT_INK.color, 4, s.points, 'mouse').d)
    expect(s.d).not.toBe(finishStroke('x', 'pen', DEFAULT_INK.color, 4, s.points, 'pen').d)
  })

  test('highlighter strokes render with the highlighter opacity', () => {
    const hl = finishStroke('h1', 'highlighter', '#daaa14', 16, [[0, 0, 0.5], [50, 0, 0.5]], 'mouse')
    const { container } = setup({ strokes: [stroke('a', [[0, 0], [10, 10]]), hl] })
    const paths = container.querySelectorAll('[data-ink-layer] path[data-stroke-id]')
    expect(paths).toHaveLength(2)
    expect(paths[1].getAttribute('fill')).toBe('#daaa14')
    expect(paths[1].getAttribute('fill-opacity')).toBe('0.35')
    expect(paths[0].getAttribute('fill-opacity')).toBeNull()
  })

  test('wacom eraser end erases while held', () => {
    const a = stroke('a', [[0, 0], [100, 0]])
    const b = stroke('b', [[0, 200], [100, 200]])
    const { capture, onStrokesChange } = setup({ strokes: [a, b] })
    const el = capture()!
    fire(el, 'pointerdown', { pointerType: 'pen', x: 50, y: -20, buttons: 32, button: 5, pressure: 0.5 })
    fire(el, 'pointermove', { pointerType: 'pen', x: 50, y: 20, buttons: 32, button: -1, pressure: 0.5 })
    fire(el, 'pointerup', { pointerType: 'pen', x: 50, y: 20, buttons: 0, button: 5 })
    expect(onStrokesChange).toHaveBeenCalledTimes(1)
    expect(onStrokesChange.mock.calls[0][1]).toBe('erase')
    expect((onStrokesChange.mock.calls[0][0] as InkStroke[]).map((s) => s.id)).toEqual(['b'])
  })

  test('eraser removes only hit strokes; no call when nothing is hit', () => {
    const a = stroke('a', [[0, 0], [100, 0]])
    const b = stroke('b', [[0, 200], [100, 200]])
    const eraser: InkToolState = { tool: 'eraser', color: DEFAULT_INK.color, width: 4 }
    const { capture, onStrokesChange } = setup({ strokes: [a, b], tool: eraser })
    const el = capture()!
    // Passes 8 px from stroke b (within 10 screen px at zoom 1).
    fire(el, 'pointerdown', { pointerType: 'mouse', x: 20, y: 208 })
    fire(el, 'pointermove', { pointerType: 'mouse', x: 80, y: 208 })
    fire(el, 'pointerup', { pointerType: 'mouse', x: 80, y: 208 })
    expect(onStrokesChange).toHaveBeenCalledTimes(1)
    expect(onStrokesChange.mock.calls[0]).toEqual([[a], 'erase'])
    // Far from both: nothing is hit, no call.
    fire(el, 'pointerdown', { pointerType: 'mouse', x: 20, y: 100 })
    fire(el, 'pointermove', { pointerType: 'mouse', x: 80, y: 100 })
    fire(el, 'pointerup', { pointerType: 'mouse', x: 80, y: 100 })
    expect(onStrokesChange).toHaveBeenCalledTimes(1)
  })

  test('barrel button never draws', () => {
    const { capture, onStrokesChange } = setup()
    const el = capture()!
    fire(el, 'pointerdown', { pointerType: 'pen', x: 0, y: 0, buttons: 3, pressure: 0.5 })
    fire(el, 'pointermove', { pointerType: 'pen', x: 30, y: 0, buttons: 3, pressure: 0.5 })
    fire(el, 'pointerup', { pointerType: 'pen', x: 30, y: 0 })
    expect(onStrokesChange).not.toHaveBeenCalled()
  })

  test('touch ignored while the pen is down', () => {
    const { capture, onStrokesChange, container } = setup()
    const el = capture()!
    fire(el, 'pointerdown', { pointerType: 'pen', pointerId: 1, x: 0, y: 0, pressure: 0.5 })
    // A palm touches down and moves while the pen draws.
    fire(el, 'pointerdown', { pointerType: 'touch', pointerId: 2, x: 300, y: 300 })
    fire(el, 'pointermove', { pointerType: 'touch', pointerId: 2, x: 320, y: 320 })
    fire(el, 'pointermove', { pointerType: 'pen', pointerId: 1, x: 30, y: 0, pressure: 0.5 })
    expect(container.querySelector('[data-ink-live]')).not.toBeNull()
    fire(el, 'pointerup', { pointerType: 'touch', pointerId: 2, x: 320, y: 320 })
    fire(el, 'pointerup', { pointerType: 'pen', pointerId: 1, x: 30, y: 0 })
    expect(onStrokesChange).toHaveBeenCalledTimes(1)
    const s = onStrokesChange.mock.calls[0][0][0] as InkStroke
    expect(s.points.every(([x, y]) => x <= 30 && y === 0)).toBe(true)
    expect(container.querySelector('[data-ink-live]')).toBeNull()
  })

  test('a palm already down does not block the pen: the pen draws and the palm is dropped', () => {
    const { capture, onStrokesChange } = setup()
    const el = capture()!
    fire(el, 'pointerdown', { pointerType: 'touch', pointerId: 2, x: 300, y: 300 })
    fire(el, 'pointermove', { pointerType: 'touch', pointerId: 2, x: 320, y: 320 })
    fire(el, 'pointerdown', { pointerType: 'pen', pointerId: 1, x: 0, y: 0, pressure: 0.5 })
    fire(el, 'pointermove', { pointerType: 'pen', pointerId: 1, x: 30, y: 0, pressure: 0.5 })
    fire(el, 'pointerup', { pointerType: 'pen', pointerId: 1, x: 30, y: 0 })
    fire(el, 'pointerup', { pointerType: 'touch', pointerId: 2, x: 320, y: 320 })
    expect(onStrokesChange).toHaveBeenCalledTimes(1)
    const next = onStrokesChange.mock.calls[0][0] as InkStroke[]
    expect(next).toHaveLength(1)
    expect(next[0].points.every(([x, y]) => x <= 30 && y === 0)).toBe(true)
  })

  test('no capture overlay without a tool, when read-only or while panning', () => {
    expect(setup({ tool: null }).capture()).toBeNull()
    expect(setup({ readOnly: true }).capture()).toBeNull()
    expect(setup({ panning: true }).capture()).toBeNull()
    const { capture, container } = setup()
    const el = capture() as HTMLElement
    expect(el).not.toBeNull()
    expect(el.style.touchAction).toBe('none')
    expect(el.style.cursor).toBe('crosshair')
    // The stroke layer itself never takes pointer events.
    const svg = container.querySelector('[data-ink-layer]') as SVGElement
    expect(svg.style.pointerEvents).toBe('none')
  })

  test('wheel is forwarded while an ink tool is on', () => {
    const { capture, onWheel } = setup()
    const el = capture()!
    act(() => {
      el.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 100 }))
    })
    expect(onWheel).toHaveBeenCalledTimes(1)
    expect((onWheel.mock.calls[0][0] as WheelEvent).deltaY).toBe(100)
  })
})

describe('InkLayer select and partial erase (M8)', () => {
  const select: InkToolState = { tool: 'select', color: DEFAULT_INK.color, width: 4 }

  test('lasso selects strokes and Delete removes them', () => {
    const a = stroke('a', [[10, 10], [40, 40]])
    const b = stroke('b', [[300, 300], [340, 300]])
    const { capture, onStrokesChange, container } = setup({ strokes: [a, b], tool: select })
    const el = capture() as HTMLElement
    expect(el.style.cursor).toBe('default')
    fire(el, 'pointerdown', { pointerType: 'mouse', x: 0, y: 0 })
    fire(el, 'pointermove', { pointerType: 'mouse', x: 60, y: 0 })
    fire(el, 'pointermove', { pointerType: 'mouse', x: 60, y: 60 })
    expect(container.querySelector('[data-ink-lasso]')).not.toBeNull()
    fire(el, 'pointermove', { pointerType: 'mouse', x: 0, y: 60 })
    fire(el, 'pointerup', { pointerType: 'mouse', x: 0, y: 60 })
    expect(container.querySelector('[data-ink-lasso]')).toBeNull()
    expect(container.querySelectorAll('[data-ink-selection] [data-ink-handle]')).toHaveLength(4)
    expect(onStrokesChange).not.toHaveBeenCalled()
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }))
    })
    expect(onStrokesChange).toHaveBeenCalledTimes(1)
    expect(onStrokesChange.mock.calls[0]).toEqual([[b], 'erase'])
  })

  test('click selects a stroke; dragging moves only it', () => {
    const a = stroke('a', [[10, 10], [100, 10]])
    const b = stroke('b', [[10, 200], [100, 200]])
    const { capture, onStrokesChange, container } = setup({ strokes: [a, b], tool: select })
    const el = capture()!
    fire(el, 'pointerdown', { pointerType: 'mouse', x: 50, y: 12 })
    fire(el, 'pointermove', { pointerType: 'mouse', x: 70, y: 42 })
    expect(container.querySelector('[data-ink-preview]')?.getAttribute('transform')).toBe('translate(20 30)')
    fire(el, 'pointerup', { pointerType: 'mouse', x: 70, y: 42 })
    expect(onStrokesChange).toHaveBeenCalledTimes(1)
    const [next, label] = onStrokesChange.mock.calls[0] as [InkStroke[], string]
    expect(label).toBe('draw')
    expect(next[1]).toBe(b)
    expect(next[0].id).toBe('a')
    expect(next[0].points).toEqual([
      [30, 40, 0.5],
      [120, 40, 0.5],
    ])
  })

  test('dragging a corner handle scales the selection', () => {
    const a = stroke('a', [[0, 0], [100, 0], [100, 100]])
    const { capture, onStrokesChange, rerender } = setup({ strokes: [a], tool: select })
    const el = capture()!
    // Select by clicking, then drag the se handle (box 102,102) out to 204,204.
    fire(el, 'pointerdown', { pointerType: 'mouse', x: 50, y: 1 })
    fire(el, 'pointerup', { pointerType: 'mouse', x: 50, y: 1 })
    expect(onStrokesChange).not.toHaveBeenCalled()
    void rerender
    fire(el, 'pointerdown', { pointerType: 'mouse', x: 102, y: 102 })
    fire(el, 'pointermove', { pointerType: 'mouse', x: 206, y: 206 })
    fire(el, 'pointerup', { pointerType: 'mouse', x: 206, y: 206 })
    expect(onStrokesChange).toHaveBeenCalledTimes(1)
    const s = (onStrokesChange.mock.calls[0][0] as InkStroke[])[0]
    expect(s.id).toBe('a')
    expect(s.width).toBe(8)
    expect(s.points.map(([x, y]) => [Math.round(x), Math.round(y)])).toEqual([
      [2, 2],
      [202, 2],
      [202, 202],
    ])
  })

  test('partial erase splits a stroke through the layer', () => {
    const a = stroke('a', [[0, 100], [200, 100]])
    const eraser: InkToolState = { tool: 'eraser', color: DEFAULT_INK.color, width: 4, eraseMode: 'partial' }
    const { capture, onStrokesChange } = setup({ strokes: [a], tool: eraser })
    const el = capture()!
    fire(el, 'pointerdown', { pointerType: 'mouse', x: 100, y: 80 })
    fire(el, 'pointermove', { pointerType: 'mouse', x: 100, y: 120 })
    fire(el, 'pointerup', { pointerType: 'mouse', x: 100, y: 120 })
    expect(onStrokesChange).toHaveBeenCalledTimes(1)
    const [next, label] = onStrokesChange.mock.calls[0] as [InkStroke[], string]
    expect(label).toBe('erase')
    expect(next).toHaveLength(2)
    expect(next.every((s) => s.id !== 'a')).toBe(true)
    expect(new Set(next.map((s) => s.id)).size).toBe(2)
  })

  test('stroke mode unchanged', () => {
    // Regression guard (green from the start): the eraser in stroke mode removes whole strokes.
    const a = stroke('a', [[0, 100], [200, 100]])
    const eraser: InkToolState = { tool: 'eraser', color: DEFAULT_INK.color, width: 4, eraseMode: 'stroke' }
    const { capture, onStrokesChange } = setup({ strokes: [a], tool: eraser })
    const el = capture()!
    fire(el, 'pointerdown', { pointerType: 'mouse', x: 100, y: 80 })
    fire(el, 'pointermove', { pointerType: 'mouse', x: 100, y: 120 })
    fire(el, 'pointerup', { pointerType: 'mouse', x: 100, y: 120 })
    expect(onStrokesChange.mock.calls[0]).toEqual([[], 'erase'])
  })
})
