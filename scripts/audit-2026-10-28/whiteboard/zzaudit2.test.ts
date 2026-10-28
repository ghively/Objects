import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { api, ApiError } from '@/api/client'
import * as A from './actions'
import { createBoardStore } from './store'
import { board, node, edge } from './test/boards'
import { useInkDoc } from './ink/useInkDoc'

describe('audit2', () => {
  test('two frames dragged together: contents move twice', () => {
    const s = createBoardStore({ doc: { board: board([
      node({ id: 'f1', kind: 'frame', position: { x: 0, y: 0 }, width: 300, height: 300, z: 0 }),
      node({ id: 'f2', kind: 'frame', position: { x: 600, y: 0 }, width: 300, height: 300, z: -1 }),
      node({ id: 'a', kind: 'shape', position: { x: 30, y: 30 }, width: 90, height: 90, z: 1 }),
      node({ id: 'b', kind: 'shape', position: { x: 630, y: 30 }, width: 90, height: 90, z: 2 }),
    ]), strokes: [] } })
    s.getState().canvas.beginDrag(['f1', 'f2'])
    s.getState().canvas.applyFlowChanges([
      { type: 'position', id: 'f1', position: { x: 60, y: 0 }, dragging: true },
      { type: 'position', id: 'f2', position: { x: 660, y: 0 }, dragging: true },
    ])
    s.getState().canvas.endDrag()
    const n = s.getState().doc.board.nodes
    console.log('AUDIT frames moved 60; a.x (expect 90)=', n.a.position.x, 'b.x (expect 690)=', n.b.position.x)
  })

  test('duplicate a selected line', () => {
    let b = A.createFromTool(board(), 'line', { x: 0, y: 0 }, { id: 'L' })
    const r = A.duplicateSelection(b, ['L'])
    console.log('AUDIT duplicate line ids:', r.ids.length)
  })

  test('ink save failure is dropped', async () => {
    vi.useFakeTimers()
    vi.spyOn(api, 'onChange').mockImplementation(() => () => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    let n = 0
    const client = {
      load: vi.fn(async () => ({ path: 'p', strokes: [], revision: 'r1' })),
      save: vi.fn(async () => { n++; if (n === 1) throw new ApiError(500, 'down'); return { revision: 'r2' } }),
    }
    const hook = renderHook(() => useInkDoc('Whiteboards/B.md', client))
    await act(async () => { await vi.advanceTimersByTimeAsync(10) })
    const st = { id: 'S1', tool: 'pen' as const, color: '#5c5959', width: 4, points: [[0, 0, 0.5]] as [number, number, number][], d: 'M 0 0 Q 0 0 0 0 Z' }
    act(() => hook.result.current.save([st]))
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    await act(async () => { await hook.result.current.flush() })
    console.log('AUDIT ink save calls after failure+flush:', client.save.mock.calls.length, 'readOnly', hook.result.current.readOnlyReason)
    hook.unmount()
    vi.useRealTimers()
  })
})
