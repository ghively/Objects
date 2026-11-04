import '@/whiteboard/test/flowEnv'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { Position, ReactFlow, ReactFlowProvider, type NodeTypes as FlowNodeTypes } from '@xyflow/react'
import { useStore as useZustand } from 'zustand'
import { describe, expect, test } from 'vitest'
import type { WhiteboardData } from '@/api/whiteboardTypes'
import type { FlowEdge, FlowNode } from '../canvasTypes'
import { toFlow } from '../flowMapping'
import { BoardStoreContext, createBoardStore, type BoardStore } from '../store'
import { board, edge, node, textBlock } from '../test/boards'
import { edgeTypes } from './index'

function Box() {
  return <div style={{ width: 100, height: 100 }} />
}
const boxTypes = { boardBlock: Box, boardShape: Box, boardFrame: Box, boardPoint: Box } as unknown as FlowNodeTypes

function withHandles(n: FlowNode): FlowNode {
  return {
    ...n,
    width: 100,
    height: 100,
    measured: { width: 100, height: 100 },
    handles: [
      { id: 'right', type: 'source', position: Position.Right, x: 100, y: 50, width: 1, height: 1 },
      { id: 'left', type: 'target', position: Position.Left, x: 0, y: 50, width: 1, height: 1 },
    ],
  }
}

/** The board rendered through React Flow with our connector, re-projected from the store. */
function Flow({ store }: { store: BoardStore }) {
  const doc = useZustand(store, (s) => s.doc)
  const selection = useZustand(store, (s) => s.selection)
  const { nodes, edges } = toFlow(doc.board, new Set(selection))
  return (
    <div style={{ width: 1000, height: 800 }}>
      <ReactFlow<FlowNode, FlowEdge>
        nodes={nodes.map(withHandles)}
        edges={edges.map((e) => ({ ...e, sourceHandle: 'right', targetHandle: 'left' }))}
        nodeTypes={boxTypes}
        edgeTypes={edgeTypes as never}
      />
    </div>
  )
}

function setup(
  extra: { blocks?: WhiteboardData['blocks'] } & Partial<WhiteboardData> = {},
  edgePatch: Parameters<typeof edge>[0] = {},
) {
  const { blocks = {}, ...rest } = extra
  const b = board(
    [node({ id: 'a', position: { x: 0, y: 0 } }), node({ id: 'b', position: { x: 400, y: 200 } })],
    [edge({ id: 'e1', source: 'a', target: 'b', ...edgePatch })],
    blocks,
    rest,
  )
  const store = createBoardStore({ doc: { board: b, strokes: [] } })
  const utils = render(
    <BoardStoreContext.Provider value={store}>
      <ReactFlowProvider>
        <Flow store={store} />
      </ReactFlowProvider>
    </BoardStoreContext.Provider>,
  )
  return { store, ...utils }
}

const connector = (c: HTMLElement) => c.querySelector('[data-whiteboard-connector="e1"]') as SVGGElement
const visiblePath = (c: HTMLElement) => connector(c).querySelector('path.react-flow__edge-path') as SVGPathElement

describe('ConnectorEdge', () => {
  test('unset connection renders cornered and unset line solid', () => {
    const { container } = setup()
    const g = connector(container)
    expect(g).not.toBeNull()
    expect(g.getAttribute('data-connection')).toBe('cornered')
    const p = visiblePath(container)
    expect(p.getAttribute('d')).toContain('Q')
    expect(p.style.strokeDasharray).toBe('')
    expect(p.style.strokeLinecap).toBe('round')
    // the invisible wide hit stroke
    const hit = g.querySelector('path.react-flow__edge-interaction')!
    expect(hit.getAttribute('stroke-width')).toBe('20')
    expect(hit.getAttribute('stroke-opacity')).toBe('0')
  })

  test('straight, cornered and curved paths', () => {
    const straight = setup({}, { connection: 'straight' })
    expect(visiblePath(straight.container).getAttribute('d')).not.toMatch(/[QC]/)
    straight.unmount()
    const curved = setup({}, { connection: 'curved', line: 'dashed' })
    expect(visiblePath(curved.container).getAttribute('d')).toContain('C')
    expect(visiblePath(curved.container).style.strokeDasharray).toBe('8 8')
  })

  test('markers none, arrow, dot, double at start and end; arrowClosed renders as arrow', () => {
    const { container } = setup({}, { markerStart: 'dot', markerEnd: 'arrowClosed', color: 'blue' })
    const p = visiblePath(container)
    expect(p.getAttribute('marker-start')).toBe('url(#wb-tip-dot-blue)')
    expect(p.getAttribute('marker-end')).toBe('url(#wb-tip-arrow-blue)')
  })

  test('edge colour applies to stroke and markers', () => {
    const { container, store } = setup({}, { color: 'red', markerEnd: 'double' })
    expect(visiblePath(container).style.stroke).not.toBe('')
    expect(visiblePath(container).getAttribute('marker-end')).toBe('url(#wb-tip-double-red)')
    act(() => store.getState().actions.select(['e1']))
    expect(visiblePath(container).style.stroke).toBe('var(--color-border-block-selection)')
    expect(visiblePath(container).getAttribute('marker-end')).toBe('url(#wb-tip-double-selected)')
  })

  test('double click adds a label; emptying it removes the block', () => {
    const { container, store } = setup()
    fireEvent.doubleClick(connector(container))
    let e = store.getState().doc.board.edges.e1
    expect(e.blockId).toBeDefined()
    expect(store.getState().doc.board.blocks[e.blockId!]).toEqual({ type: 'text', markdown: '' })
    const input = container.querySelector('[data-whiteboard-edge-label-input]') as HTMLInputElement
    expect(input).not.toBeNull()
    fireEvent.change(input, { target: { value: 'uplink' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    e = store.getState().doc.board.edges.e1
    expect(store.getState().doc.board.blocks[e.blockId!]).toEqual({ type: 'text', markdown: 'uplink' })
    expect(store.getState().editingId).toBeNull()
    expect(screen.getByText('uplink')).toBeTruthy()
    // adding and typing the label are one undo step
    act(() => store.getState().actions.undo())
    expect(store.getState().doc.board.edges.e1.blockId).toBeUndefined()
    expect(store.getState().doc.board.blocks).toEqual({})
    act(() => store.getState().actions.redo())

    // edit again and empty it: the block goes
    fireEvent.doubleClick(container.querySelector('[data-whiteboard-edge-label="e1"]')!)
    const again = container.querySelector('[data-whiteboard-edge-label-input]') as HTMLInputElement
    expect(again.value).toBe('uplink')
    fireEvent.change(again, { target: { value: '   ' } })
    fireEvent.blur(again)
    expect(store.getState().doc.board.edges.e1.blockId).toBeUndefined()
    expect(store.getState().doc.board.blocks).toEqual({})
    expect(container.querySelector('[data-whiteboard-edge-label="e1"]')).toBeNull()
  })

  test('deprecated label renders and converts to a block on edit', () => {
    const { container, store } = setup({}, { label: 'legacy' })
    expect(screen.getByText('legacy')).toBeTruthy()
    fireEvent.doubleClick(container.querySelector('[data-whiteboard-edge-label="e1"]')!)
    const input = container.querySelector('[data-whiteboard-edge-label-input]') as HTMLInputElement
    expect(input.value).toBe('legacy')
    fireEvent.change(input, { target: { value: 'legacy link' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    const e = store.getState().doc.board.edges.e1
    expect('label' in e).toBe(false)
    expect(store.getState().doc.board.blocks[e.blockId!]).toEqual({ type: 'text', markdown: 'legacy link' })
  })

  test('an existing label block renders; a locked board does not edit', () => {
    const { container, store } = setup(
      { locked: true, blocks: { bl: textBlock('wan') } },
      { blockId: 'bl' },
    )
    expect(screen.getByText('wan')).toBeTruthy()
    fireEvent.doubleClick(connector(container))
    expect(store.getState().editingId).toBeNull()
    expect(container.querySelector('[data-whiteboard-edge-label-input]')).toBeNull()
  })
})
