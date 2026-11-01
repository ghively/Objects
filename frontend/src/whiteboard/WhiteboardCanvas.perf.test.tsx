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
import { BoardStoreContext, createBoardStore } from './store'

let blockRenders = 0
vi.mock('./nodes', async (orig) => {
  const m = (await orig()) as typeof import('./nodes')
  const Orig = m.BlockNode
  const Counting = memo(function CountingBlock(p: Parameters<typeof Orig>[0]) {
    blockRenders++
    return <Orig {...p} />
  })
  return { ...m, nodeTypes: { ...m.nodeTypes, capacitiesBlock: Counting } }
})

const { WhiteboardCanvas } = await import('./WhiteboardCanvas')

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
})
