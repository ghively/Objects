import '@/whiteboard/test/flowEnv'
import { act, render } from '@testing-library/react'
import { ReactFlow, ReactFlowProvider } from '@xyflow/react'
import { describe, expect, test, vi } from 'vitest'
import { InkLayer } from './ink/InkLayer'
import { DEFAULT_INK } from './ink/inkModel'
import type { InkLayerProps } from './ink/types'

function pointer(type: string, init: { pointerType: string; x: number; y: number; pointerId: number; buttons?: number }): PointerEvent {
  const ev = new PointerEvent(type, { bubbles: true, cancelable: true, clientX: init.x, clientY: init.y })
  const fields: Record<string, unknown> = {
    pointerType: init.pointerType, pressure: 0.5, buttons: init.buttons ?? (type === 'pointerup' ? 0 : 1), button: 0,
    pointerId: init.pointerId, clientX: init.x, clientY: init.y,
  }
  for (const [k, v] of Object.entries(fields)) Object.defineProperty(ev, k, { value: v, configurable: true })
  return ev
}

describe('audit: touch gestures on the ink overlay', () => {
  test('a two-finger pinch while the pen tool is armed draws a stroke with the first finger', () => {
    const onStrokesChange = vi.fn()
    const props: InkLayerProps = { strokes: [], tool: DEFAULT_INK, readOnly: false, panning: false, onStrokesChange, onWheel: vi.fn() }
    const utils = render(
      <div style={{ width: 1280, height: 800 }}>
        <ReactFlowProvider>
          <ReactFlow nodes={[]} edges={[]}>
            <InkLayer {...props} />
          </ReactFlow>
        </ReactFlowProvider>
      </div>,
    )
    const el = utils.container.querySelector('[data-ink-capture]')!
    const fire = (type: string, i: Parameters<typeof pointer>[1]) => act(() => void el.dispatchEvent(pointer(type, i)))
    fire('pointerdown', { pointerType: 'touch', x: 100, y: 100, pointerId: 1 })
    fire('pointerdown', { pointerType: 'touch', x: 300, y: 300, pointerId: 2 }) // second finger: a pinch
    fire('pointermove', { pointerType: 'touch', x: 80, y: 80, pointerId: 1 })
    fire('pointermove', { pointerType: 'touch', x: 320, y: 320, pointerId: 2 })
    fire('pointermove', { pointerType: 'touch', x: 60, y: 60, pointerId: 1 })
    fire('pointerup', { pointerType: 'touch', x: 60, y: 60, pointerId: 1 })
    fire('pointerup', { pointerType: 'touch', x: 320, y: 320, pointerId: 2 })
    console.log('strokes committed by the pinch:', onStrokesChange.mock.calls.length, onStrokesChange.mock.calls[0]?.[0]?.length)
    expect(onStrokesChange).not.toHaveBeenCalled()
  })
})
