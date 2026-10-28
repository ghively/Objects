import '@/whiteboard/test/flowEnv'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { WhiteboardData } from '@/api/whiteboardTypes'
import { OBJECT_DRAG_MIME } from './dnd'
import type { WhiteboardHost } from './host'
import { DEFAULT_SETTINGS } from './model'
import type { InkLayerProps, InkPlugin, InkStroke } from './plugin'
import { BoardStoreContext, createBoardStore, type BoardStore } from './store'
import { board, node } from './test/boards'
import { CAMERA_KEY, TOOLS_KEY, saveToolMemory } from './toolMemory'
import { WhiteboardCanvas } from './WhiteboardCanvas'

const KEY = 'Whiteboards/Board.md'

function fakeHost(): WhiteboardHost {
  return {
    openObject: vi.fn(),
    linkFor: vi.fn((path: string) => `[[${path.split('/').pop()!.replace(/\.md$/, '')}]]`),
    resolve: vi.fn(async () => null),
    rows: vi.fn(async () => []),
    requestDelete: vi.fn(),
    createObject: vi.fn(async () => 'Pages/New.md'),
    objects: vi.fn(async () => []),
  }
}

const stroke = (id: string): InkStroke => ({ id, tool: 'pen', color: '#5c5959', width: 4, points: [[0, 0, 0.5]], d: 'M0 0Z' })

function fakeInk() {
  const layerProps: InkLayerProps[] = []
  const plugin: InkPlugin = {
    Layer: (p: InkLayerProps) => {
      layerProps.push(p)
      return <div data-testid="ink-layer" data-tool={p.tool?.tool ?? ''} data-strokes={p.strokes.length} />
    },
    Toolbar: () => null,
    useInkDoc: () => ({ strokes: [], readOnlyReason: null, save: vi.fn(), flush: vi.fn(async () => {}) }),
  }
  return { plugin, layerProps }
}

interface Opts {
  doc?: { board: WhiteboardData; strokes: InkStroke[] }
  settings?: Partial<typeof DEFAULT_SETTINGS>
  ink?: InkPlugin
  host?: WhiteboardHost
  store?: BoardStore
}

function renderCanvas(opts: Opts = {}) {
  const store = opts.store ?? createBoardStore({ doc: opts.doc ?? { board: board(), strokes: [] } })
  const host = opts.host ?? fakeHost()
  const utils = render(
    <BoardStoreContext.Provider value={store}>
      <div style={{ width: 1280, height: 800 }}>
        <WhiteboardCanvas boardKey={KEY} settings={{ ...DEFAULT_SETTINGS, ...opts.settings }} host={host} ink={opts.ink} />
      </div>
    </BoardStoreContext.Provider>,
  )
  return { store, host, ...utils, wrapper: screen.getByTestId('whiteboard-canvas') }
}


describe('audit3', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn(async () => new Response('{}'))) })
  test('lost state over visible ink', async () => {
    const { plugin } = fakeInk()
    const far = board([node({ id: 'far', position: { x: 50000, y: 50000 }, width: 420, height: 60 })], [], {}, { viewport: { x: 0, y: 0, zoom: 1 } })
    const st = { ...stroke('s1'), points: [[100, 100, 0.5], [300, 300, 0.5]] as [number, number, number][] }
    renderCanvas({ doc: { board: far, strokes: [st] }, ink: plugin })
    await act(async () => {})
    const lost = document.querySelector('[data-whiteboard-lost]') as HTMLElement | null
    console.log('AUDIT lost shown with ink in view:', !!lost, 'class', lost?.className)
  })
})
