/**
 * Renders a board's nodes in a real React Flow with the node components of `nodes/index.ts`,
 * over a board store and a fake host (test helper for the node tests).
 */
import '@/whiteboard/test/flowEnv'
import { render } from '@testing-library/react'
import { ReactFlow, ReactFlowProvider } from '@xyflow/react'
import { useMemo } from 'react'
import { vi } from 'vitest'
import type { Row } from '@/api/types'
import type { WhiteboardData } from '@/api/whiteboardTypes'
import { toFlow, type FlowEdge, type FlowNode } from '../../flowMapping'
import { WhiteboardHostContext, type WhiteboardHost } from '../../host'
import { BoardStoreContext, createBoardStore, useBoardState, type BoardStore } from '../../store'
import { nodeTypes } from '..'

export function fakeHost(over: Partial<WhiteboardHost> = {}): WhiteboardHost {
  return {
    openObject: vi.fn(),
    linkFor: vi.fn((p: string) => `[[${p}]]`),
    resolve: vi.fn(async () => null),
    rows: vi.fn(async () => [] as Row[]),
    requestDelete: vi.fn(),
    createObject: vi.fn(async () => 'Pages/New.md'),
    objects: vi.fn(async () => []),
    ...over,
  }
}

export function fakeRow(path: string, title: string, type = 'Page'): Row {
  return {
    summary: {
      path,
      id: null,
      type,
      title,
      icon: null,
      iconColor: null,
      description: null,
      aliases: [],
      createdAt: null,
      lastUpdated: null,
      tags: [],
      template: null,
      color: null,
    } as unknown as Row['summary'],
    version: 'v1',
    values: {},
    links: {},
    preview: '',
  }
}

function Board() {
  const board = useBoardState((s) => s.doc.board)
  const selection = useBoardState((s) => s.selection)
  const flow = useMemo(() => toFlow(board, new Set(selection)), [board, selection])
  return (
    <div style={{ width: 1280, height: 800 }}>
      <ReactFlow<FlowNode, FlowEdge> nodes={flow.nodes} edges={flow.edges} nodeTypes={nodeTypes} proOptions={{ hideAttribution: true }} />
    </div>
  )
}

export function renderBoard(board: WhiteboardData, opts: { host?: WhiteboardHost; store?: BoardStore; selection?: string[] } = {}) {
  const store = opts.store ?? createBoardStore({ doc: { board, strokes: [] } })
  if (opts.selection) store.getState().actions.select(opts.selection)
  const host = opts.host ?? fakeHost()
  const utils = render(
    <WhiteboardHostContext.Provider value={host}>
      <BoardStoreContext.Provider value={store}>
        <div className="whiteboard-canvas">
          <ReactFlowProvider>
            <Board />
          </ReactFlowProvider>
        </div>
      </BoardStoreContext.Provider>
    </WhiteboardHostContext.Provider>,
  )
  const nodeEl = (id: string) => utils.container.querySelector(`.react-flow__node[data-id="${id}"]`) as HTMLElement | null
  return { store, host, nodeEl, ...utils }
}
