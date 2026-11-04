/**
 * Render-count and recompute-count checks for the canvas (the 2026-11-01 audit's F10). Counting
 * wrappers stand in for the block node and `strokeBoxes`, so the tests see how often each runs.
 */
import '@/whiteboard/test/flowEnv'
import { act, render } from '@testing-library/react'
import { memo } from 'react'
import { describe, expect, test, vi } from 'vitest'
import type { WhiteboardData } from '@/api/whiteboardTypes'
import type { WhiteboardHost } from './host'
import { DEFAULT_SETTINGS } from './model'
import type { InkStroke } from './plugin'
import { BoardStoreContext, createBoardStore } from './store'

let blockRenders = 0
vi.mock('./nodes', async (orig) => {
  const m = (await orig()) as typeof import('./nodes')
  const Orig = m.BlockNode
  const Counting = memo(function CountingBlock(p: Parameters<typeof Orig>[0]) {
    blockRenders++
    return <Orig {...p} />
  })
  return { ...m, nodeTypes: { ...m.nodeTypes, boardBlock: Counting } }
})

let strokeBoxCalls = 0
vi.mock('./exportPng', async (orig) => {
  const m = (await orig()) as typeof import('./exportPng')
  return {
    ...m,
    strokeBoxes: (...args: Parameters<typeof m.strokeBoxes>) => {
      strokeBoxCalls++
      return m.strokeBoxes(...args)
    },
  }
})

const { WhiteboardCanvas } = await import('./WhiteboardCanvas')
type CanvasControls = import('./WhiteboardCanvas').CanvasControls

function host(): WhiteboardHost {
  return {
    openObject: vi.fn(),
    linkFor: (p) => `[[${p}]]`,
    resolve: vi.fn(async () => null),
    rows: vi.fn(async () => []),
    requestDelete: vi.fn(),
    createObject: vi.fn(async () => 'Pages/New.md'),
    objects: vi.fn(async () => []),
  }
}

function bigBoard(n: number): WhiteboardData {
  const b: WhiteboardData = { version: 1, nodes: {}, edges: {}, blocks: {} }
  for (let i = 0; i < n; i++) {
    b.nodes[`n${i}`] = { id: `n${i}`, kind: 'block', blockId: `b${i}`, position: { x: (i % 10) * 30, y: Math.floor(i / 10) * 30 }, width: 100, height: 40, z: i + 1 }
    b.blocks[`b${i}`] = { type: 'text', markdown: `t${i}` }
  }
  return b
}

describe('WhiteboardCanvas performance', () => {
  test('nudging one of 60 nodes re-renders that node only', async () => {
    const N = 60
    const store = createBoardStore({ doc: { board: bigBoard(N), strokes: [] } })
    render(
      <BoardStoreContext.Provider value={store}>
        <div style={{ width: 1280, height: 800 }}>
          <WhiteboardCanvas boardKey="k" settings={DEFAULT_SETTINGS} host={host()} />
        </div>
      </BoardStoreContext.Provider>,
    )
    await act(async () => {})
    await act(async () => {})
    expect(blockRenders).toBeGreaterThanOrEqual(N)
    blockRenders = 0
    act(() => store.getState().actions.nudge(30, 0, ['n0']))
    await act(async () => {})
    expect(blockRenders).toBeLessThanOrEqual(2)
    // Selecting one node re-renders that node (its `selected` prop), not the others.
    blockRenders = 0
    act(() => store.getState().actions.select(['n5']))
    await act(async () => {})
    expect(blockRenders).toBeLessThanOrEqual(2)
  })

  test('the lost state computes the ink boxes once per content change, not per pan or zoom', async () => {
    // Content far away (so "Nothing in this view" shows) with a lot of ink.
    const b: WhiteboardData = {
      version: 1,
      nodes: { far: { id: 'far', kind: 'block', position: { x: 50000, y: 50000 }, width: 420, height: 60 } },
      edges: {},
      blocks: {},
      viewport: { x: 0, y: 0, zoom: 1 },
    }
    const strokes: InkStroke[] = []
    for (let i = 0; i < 200; i++) {
      strokes.push({ id: `s${i}`, tool: 'pen', color: '#000000', width: 4, points: [[50000 + i, 50000, 0.5], [50010 + i, 50020, 0.5]], d: '' })
    }
    const store = createBoardStore({ doc: { board: b, strokes } })
    let controls: CanvasControls | null = null
    render(
      <BoardStoreContext.Provider value={store}>
        <div style={{ width: 1280, height: 800 }}>
          <WhiteboardCanvas
            boardKey="lost"
            settings={DEFAULT_SETTINGS}
            host={host()}
            renderChrome={(c) => {
              controls = c
              return null
            }}
          />
        </div>
      </BoardStoreContext.Provider>,
    )
    await act(async () => {})
    expect(document.querySelector('[data-whiteboard-lost]')).not.toBeNull()
    const before = strokeBoxCalls
    expect(before).toBeGreaterThan(0)
    for (const cmd of ['in', 'out', 'in', 'out', 'in'] as const) {
      act(() => controls!.onZoom(cmd))
      await act(async () => {})
    }
    expect(document.querySelector('[data-whiteboard-lost]')).not.toBeNull()
    expect(strokeBoxCalls).toBe(before)
    // A content change recomputes them.
    act(() => store.getState().actions.setStrokes(strokes.slice(1), 'erase'))
    await act(async () => {})
    expect(strokeBoxCalls).toBeGreaterThan(before)
  })
})
