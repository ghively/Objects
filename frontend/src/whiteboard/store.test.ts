import { describe, expect, test, vi } from 'vitest'
import type { NodeChange } from '@xyflow/react'
import { createBoardStore } from './store'
import { board, edge, node, textBlock } from './test/boards'
import type { InkStroke } from './plugin'

const stroke = (id: string): InkStroke => ({ id, tool: 'pen', color: '#5c5959', width: 4, points: [[0, 0, 0.5]], d: 'M0 0Z' })

function storeWith(b = board()) {
  return createBoardStore({ doc: { board: b, strokes: [] } })
}

const pos = (id: string, x: number, y: number): NodeChange => ({ type: 'position', id, position: { x, y }, dragging: true })

describe('board store', () => {
  test('stroke and node changes share one history', () => {
    const s = storeWith()
    const a = s.getState().actions
    a.createFromTool('rectangle', { x: 45, y: 45 })
    a.setStrokes([stroke('s1')], 'draw')
    a.nudge(30, 0)
    expect(Object.keys(s.getState().doc.board.nodes)).toHaveLength(1)
    expect(s.getState().doc.strokes).toHaveLength(1)
    a.undo() // the nudge
    a.undo() // the stroke
    expect(s.getState().doc.strokes).toHaveLength(0)
    expect(Object.keys(s.getState().doc.board.nodes)).toHaveLength(1)
    a.undo() // the shape
    expect(Object.keys(s.getState().doc.board.nodes)).toHaveLength(0)
    expect(s.getState().canUndo).toBe(false)
    a.redo()
    a.redo()
    expect(s.getState().doc.strokes).toEqual([stroke('s1')])
    expect(s.getState().canRedo).toBe(true)
  })

  test('apply bumps boardSeq for the board and strokesSeq for the ink; selecting bumps nothing', () => {
    const s = storeWith(board([node({ id: 'a' })]))
    const a = s.getState().actions
    a.select(['a'])
    a.setTool('hand')
    expect(s.getState().boardSeq).toBe(0)
    expect(s.getState().strokesSeq).toBe(0)
    a.updateNode('a', { width: 600 })
    expect(s.getState().boardSeq).toBe(1)
    a.setStrokes([stroke('x')], 'draw')
    expect(s.getState().strokesSeq).toBe(1)
    expect(s.getState().boardSeq).toBe(1)
  })

  test('dragging a frame moves the nodes inside it', () => {
    const b = board([
      node({ id: 'f', kind: 'frame', title: 'Frame 1', position: { x: 0, y: 0 }, width: 480, height: 420, z: 0 }),
      node({ id: 'in', kind: 'shape', shape: 'rectangle', position: { x: 30, y: 30 }, width: 90, height: 90, z: 1 }),
      node({ id: 'out', kind: 'shape', shape: 'rectangle', position: { x: 600, y: 30 }, width: 90, height: 90, z: 2 }),
    ])
    const s = storeWith(b)
    const c = s.getState().canvas
    c.beginDrag(['f'])
    c.applyFlowChanges([pos('f', 30, 0)])
    c.applyFlowChanges([pos('f', 60, 30)])
    c.endDrag()
    const nodes = s.getState().doc.board.nodes
    expect(nodes.f.position).toEqual({ x: 60, y: 30 })
    expect(nodes.in.position).toEqual({ x: 90, y: 60 })
    expect(nodes.out.position).toEqual({ x: 600, y: 30 })
    // One drag is one undo step.
    s.getState().actions.undo()
    expect(s.getState().doc.board.nodes.f.position).toEqual({ x: 0, y: 0 })
    expect(s.getState().doc.board.nodes.in.position).toEqual({ x: 30, y: 30 })
  })

  test('dragging two frames moves the contents of each once', () => {
    const s = storeWith(board([
      node({ id: 'f1', kind: 'frame', position: { x: 0, y: 0 }, width: 300, height: 300, z: 0 }),
      node({ id: 'f2', kind: 'frame', position: { x: 600, y: 0 }, width: 300, height: 300, z: -1 }),
      node({ id: 'a', kind: 'shape', position: { x: 30, y: 30 }, width: 90, height: 90, z: 1 }),
      node({ id: 'b', kind: 'shape', position: { x: 630, y: 30 }, width: 90, height: 90, z: 2 }),
    ]))
    const c = s.getState().canvas
    c.beginDrag(['f1', 'f2'])
    c.applyFlowChanges([pos('f1', 60, 0), pos('f2', 660, 0)])
    c.endDrag()
    const n = s.getState().doc.board.nodes
    expect(n.a.position).toEqual({ x: 90, y: 30 })
    expect(n.b.position).toEqual({ x: 690, y: 30 })
  })

  test('dragging a frame with a frame inside it moves the inner contents once', () => {
    const s = storeWith(board([
      node({ id: 'outer', kind: 'frame', position: { x: 0, y: 0 }, width: 600, height: 600, z: -2 }),
      node({ id: 'inner', kind: 'frame', position: { x: 30, y: 30 }, width: 300, height: 300, z: -1 }),
      node({ id: 'a', kind: 'shape', position: { x: 60, y: 60 }, width: 90, height: 90, z: 1 }),
    ]))
    const c = s.getState().canvas
    c.beginDrag(['outer', 'inner'])
    c.applyFlowChanges([pos('outer', 30, 0), pos('inner', 60, 30)])
    c.endDrag()
    expect(s.getState().doc.board.nodes.a.position).toEqual({ x: 90, y: 60 })
  })

  test('alt-drag duplicates: copies stay, originals move, one step', () => {
    const s = storeWith(board([node({ id: 'a', kind: 'shape', shape: 'ellipse', position: { x: 0, y: 0 }, width: 90, height: 90, z: 1 })]))
    const c = s.getState().canvas
    c.beginDrag(['a'], { duplicate: true })
    c.applyFlowChanges([pos('a', 120, 0)])
    c.endDrag()
    const nodes = Object.values(s.getState().doc.board.nodes)
    expect(nodes).toHaveLength(2)
    expect(nodes.map((n) => n.position.x).sort((x, y) => x - y)).toEqual([0, 120])
    s.getState().actions.undo()
    expect(Object.keys(s.getState().doc.board.nodes)).toEqual(['a'])
  })

  test('alt-drag of a frame: the copy stays where the frame was', () => {
    const s = storeWith(board([
      node({ id: 'f', kind: 'frame', position: { x: 0, y: 0 }, width: 300, height: 300, z: 0 }),
      node({ id: 'a', kind: 'shape', position: { x: 30, y: 30 }, width: 90, height: 90, z: 1 }),
    ]))
    const c = s.getState().canvas
    c.beginDrag(['f'], { duplicate: true })
    c.applyFlowChanges([pos('f', 600, 0)])
    c.endDrag()
    const nodes = s.getState().doc.board.nodes
    const copy = Object.values(nodes).find((n) => n.kind === 'frame' && n.id !== 'f')!
    expect(copy.position).toEqual({ x: 0, y: 0 })
    expect(nodes.f.position).toEqual({ x: 600, y: 0 })
    expect(nodes.a.position).toEqual({ x: 630, y: 30 })
  })

  test('two resize gestures of the same node are two undo steps', () => {
    const s = storeWith(board([node({ id: 'a', kind: 'shape', position: { x: 0, y: 0 }, width: 90, height: 90 })]))
    const c = s.getState().canvas
    const rs = (width: number, resizing = true) =>
      c.applyFlowChanges([{ type: 'dimensions', id: 'a', dimensions: { width, height: 90 }, resizing }])
    rs(120)
    rs(150)
    rs(150, false) // React Flow's resize end
    rs(200)
    rs(240)
    rs(240, false)
    s.getState().actions.undo()
    expect(s.getState().doc.board.nodes.a.width).toBe(150)
    s.getState().actions.undo()
    expect(s.getState().doc.board.nodes.a.width).toBe(90)
  })

  test('auto-sized blocks use their measured size for frame containment and wrapping', () => {
    const s = storeWith(board([
      node({ id: 'f', kind: 'frame', position: { x: 0, y: 0 }, width: 300, height: 300, z: 0 }),
      node({ id: 't', kind: 'block', position: { x: 30, y: 30 }, z: 1 }), // no width/height: auto-sized
    ]))
    const c = s.getState().canvas
    c.measure({ t: { width: 200, height: 40 } })
    c.beginDrag(['f'])
    c.applyFlowChanges([pos('f', 60, 0)])
    c.endDrag()
    expect(s.getState().doc.board.nodes.t.position).toEqual({ x: 90, y: 30 })
    s.getState().actions.nudge(-60, 0, ['f'])
    expect(s.getState().doc.board.nodes.t.position).toEqual({ x: 30, y: 30 })

    s.getState().actions.wrapInFrame(['t'])
    const frame = Object.values(s.getState().doc.board.nodes).find((n) => n.kind === 'frame' && n.id !== 'f')!
    expect(frame.position).toEqual({ x: 0, y: 0 })
    expect({ w: frame.width, h: frame.height }).toEqual({ w: 270, h: 120 })
  })

  test('clear whiteboard clears board and ink in one undo step', () => {
    const b = board([node({ id: 'a', blockId: 'b1' })], [], { b1: textBlock('hi') }, { viewport: { x: 1, y: 2, zoom: 1 } })
    const s = createBoardStore({ doc: { board: b, strokes: [stroke('s1')] } })
    s.getState().actions.clearBoard()
    expect(s.getState().doc.board.nodes).toEqual({})
    expect(s.getState().doc.board.blocks).toEqual({})
    expect(s.getState().doc.board.viewport).toEqual({ x: 1, y: 2, zoom: 1 })
    expect(s.getState().doc.strokes).toEqual([])
    expect(s.getState().boardSeq).toBe(1)
    expect(s.getState().strokesSeq).toBe(1)
    s.getState().actions.undo()
    expect(s.getState().doc.board).toBe(b)
    expect(s.getState().doc.strokes).toEqual([stroke('s1')])
  })

  test('locked board is view only; unlock still works', () => {
    const s = storeWith(board([node({ id: 'a' })], [], {}, { locked: true }))
    const a = s.getState().actions
    a.createFromTool('text', { x: 0, y: 0 })
    a.removeSelection(['a'])
    a.nudge(30, 30, ['a'])
    a.setStrokes([stroke('s')], 'draw')
    a.clearBoard()
    expect(s.getState().boardSeq).toBe(0)
    expect(s.getState().strokesSeq).toBe(0)
    a.setLocked(false)
    expect(s.getState().doc.board.locked).toBeUndefined()
    a.nudge(30, 0, ['a'])
    expect(s.getState().doc.board.nodes.a.position.x).toBe(30)
  })

  test('read-only refuses every edit, undo included', () => {
    const s = storeWith(board([node({ id: 'a' })]))
    s.getState().actions.nudge(30, 0, ['a'])
    s.getState().canvas.setReadOnly('unreadable')
    s.getState().actions.undo()
    s.getState().actions.setLocked(true)
    s.getState().actions.nudge(30, 0, ['a'])
    expect(s.getState().doc.board.nodes.a.position.x).toBe(30)
    expect(s.getState().doc.board.locked).toBeUndefined()
  })

  test('one-shot tools return to Move after placing and the created item is selected', () => {
    const s = storeWith()
    const a = s.getState().actions
    a.setTool('ellipse')
    const id = a.createFromTool('ellipse', { x: 100, y: 100, width: 200, height: 100 })
    expect(id).toBeTruthy()
    expect(s.getState().tool).toBe('select')
    expect(s.getState().selection).toEqual([id])
    expect(s.getState().memory.lastShapeTool).toBe('ellipse')
  })

  test('new connectors copy the remembered style', () => {
    const s = storeWith(board([node({ id: 'a' }), node({ id: 'b', position: { x: 600, y: 0 } })]))
    const a = s.getState().actions
    a.remember({ lastEdgeConnection: 'curved', lastEdgeLine: 'dashed' })
    const id = a.connect('a', 'b', { sourceHandle: 'right', targetHandle: 'left' })
    expect(s.getState().doc.board.edges[id!]).toMatchObject({ connection: 'curved', line: 'dashed', sourceHandle: 'right' })
  })

  test('remove selection drops touching edges and clears the selection of removed ids', () => {
    const s = storeWith(board([node({ id: 'a' }), node({ id: 'b' })], [edge({ id: 'e', source: 'a', target: 'b' })]))
    const a = s.getState().actions
    a.select(['a', 'e'])
    a.removeSelection()
    expect(s.getState().doc.board.edges).toEqual({})
    expect(s.getState().selection).toEqual([])
  })

  test('tool memory changes are reported for persisting', () => {
    const onMemory = vi.fn()
    const s = createBoardStore({ onMemory })
    s.getState().actions.setTool('hand')
    expect(onMemory).toHaveBeenLastCalledWith(expect.objectContaining({ lastUsedTool: 'hand', lastPointerTool: 'hand' }))
  })

  test('loading strokes from the ink file is not an undo step', () => {
    const s = storeWith()
    s.getState().canvas.loadStrokes([stroke('a')])
    expect(s.getState().canUndo).toBe(false)
    expect(s.getState().strokesSeq).toBe(0)
  })
})
