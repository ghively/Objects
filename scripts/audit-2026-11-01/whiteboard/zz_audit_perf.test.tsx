import '@/whiteboard/test/flowEnv'
import { act, render } from '@testing-library/react'
import { memo } from 'react'
import { describe, expect, test, vi } from 'vitest'
import type { WhiteboardData } from '@/api/whiteboardTypes'
import type { WhiteboardHost } from './host'
import { DEFAULT_SETTINGS } from './model'
import { BoardStoreContext, createBoardStore } from './store'
import { strokeBoxes } from './exportPng'
import type { InkStroke } from './plugin'

let blockRenders = 0
vi.mock('./nodes', async (orig) => {
  const m = (await orig()) as typeof import('./nodes')
  const Orig = m.BlockNode
  const Counting = memo(function CountingBlock(p: Parameters<typeof Orig>[0]) {
    blockRenders++
    return <Orig {...p} />
  })
  return { ...m, nodeTypes: { ...m.nodeTypes, objectBlock: Counting } }
})

const { WhiteboardCanvas } = await import('./WhiteboardCanvas')

function host(): WhiteboardHost {
  return {
    openObject: vi.fn(), linkFor: (p) => `[[${p}]]`, resolve: vi.fn(async () => null), rows: vi.fn(async () => []),
    requestDelete: vi.fn(), createObject: vi.fn(async () => 'Pages/New.md'), objects: vi.fn(async () => []),
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

describe('audit: canvas performance', () => {
  test('moving one node re-renders every node component', async () => {
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
    const mounted = blockRenders
    blockRenders = 0
    act(() => store.getState().actions.nudge(30, 0, ['n0']))
    await act(async () => {})
    console.log(`block nodes mounted renders=${mounted}; renders caused by nudging ONE of ${N} nodes: ${blockRenders}`)
    expect(blockRenders).toBeLessThanOrEqual(2)
  })

  test('strokeBoxes over a large ink set (LostState runs this on every viewport change)', () => {
    const strokes: InkStroke[] = []
    for (let s = 0; s < 5000; s++) {
      const pts: [number, number, number][] = []
      for (let i = 0; i < 200; i++) pts.push([s * 3 + i, (s % 50) * 7 + i * 0.3, 0.5])
      strokes.push({ id: `s${s}`, tool: 'pen', color: '#000000', width: 4, points: pts, d: '' })
    }
    const t0 = performance.now()
    for (let k = 0; k < 10; k++) strokeBoxes(strokes)
    const ms = (performance.now() - t0) / 10
    console.log(`strokeBoxes(5000 strokes x 200 pts): ${ms.toFixed(1)} ms per call`)
    expect(ms).toBeLessThan(2)
  })
})
