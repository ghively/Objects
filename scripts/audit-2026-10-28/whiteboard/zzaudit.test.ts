import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { api, ApiError } from '@/api/client'
import * as A from './actions'
import { createBoardStore } from './store'
import { board, node } from './test/boards'
import { mockWhiteboardApi } from './test/mockWhiteboardApi'
import { useBoard } from './useBoard'
import { mergeBoards } from './merge'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig()),
  api: (await import('@/test/mockApi')).mockApi(),
}))
beforeEach(() => { vi.mocked(api).onChange.mockImplementation(() => () => undefined) })
afterEach(() => vi.useRealTimers())

describe('audit', () => {
  test('save failure retry loop', async () => {
    const client = mockWhiteboardApi(board([node({ id: 'a', position: { x: 0, y: 0 } })]), 'rev-1')
    let n = 0
    client.saveBoard.mockImplementation(async () => { n++; if (n < 1000) throw new ApiError(500, 'boom'); return { revision: 'r' } })
    const hook = renderHook(() => useBoard('Whiteboards/Board.md', client))
    await waitFor(() => expect(hook.result.current.status).toBe('ready'))
    const store = hook.result.current.store
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    act(() => store.getState().actions.nudge(30, 0, ['a']))
    const t0 = Date.now(); await new Promise((r) => setTimeout(r, 600))
    console.log('elapsed', Date.now() - t0, 'toast', hook.result.current.toast, 'saveBoard calls:', client.saveBoard.mock.calls.length)
    hook.unmount()
  })

  test('alt-drag duplicate of a frame: copy follows', () => {
    const s = createBoardStore({ doc: { board: board([
      node({ id: 'f', kind: 'frame', position: { x: 0, y: 0 }, width: 300, height: 300, z: 0 }),
    ]), strokes: [] } })
    s.getState().canvas.beginDrag(['f'], { duplicate: true })
    s.getState().canvas.applyFlowChanges([{ type: 'position', id: 'f', position: { x: 600, y: 0 }, dragging: true }])
    s.getState().canvas.endDrag()
    const nodes = Object.values(s.getState().doc.board.nodes)
    console.log('frames after alt-drag:', nodes.map((n) => [n.id.slice(0, 4), n.position.x]))
  })

  test('two separate resizes coalesce into one undo step', () => {
    const s = createBoardStore({ doc: { board: board([node({ id: 'a', kind: 'shape', position: { x: 0, y: 0 }, width: 90, height: 90 })]), strokes: [] } })
    const rs = (w: number) => s.getState().canvas.applyFlowChanges([{ type: 'dimensions', id: 'a', dimensions: { width: w, height: 90 }, resizing: true }])
    rs(120); rs(150)
    s.getState().actions.select(['a'])
    s.getState().actions.select([])
    rs(200); rs(240)
    s.getState().actions.undo()
    console.log('width after one undo (expect 150):', s.getState().doc.board.nodes.a.width, 'canUndo', s.getState().canUndo)
  })

  test('wrapInFrame of auto-sized text', () => {
    const b = board([node({ id: 't', kind: 'block', position: { x: 0, y: 0 } })])
    const w = A.wrapInFrame(b, ['t'], { id: 'f' })
    console.log('frame', w.nodes.f.width, w.nodes.f.height)
  })

  test('merge: remote deleted node, local edited its block text', () => {
    const base = board([node({ id: 'a', kind: 'block', blockId: 'b1', position: { x: 0, y: 0 } })])
    base.blocks = { b1: { type: 'text', markdown: 'x' } }
    const local = structuredClone(base); local.blocks.b1 = { type: 'text', markdown: 'y' }
    const remote = { ...structuredClone(base), nodes: {}, blocks: {} }
    const m = mergeBoards(base, local, remote)
    console.log('merged nodes', Object.keys(m.nodes), 'blocks', Object.keys(m.blocks))
  })
})
